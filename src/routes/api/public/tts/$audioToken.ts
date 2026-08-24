import { createFileRoute } from "@tanstack/react-router";
import { sha256Hex } from "@/lib/bunny.server";

// Proxy público assinado para áudios TTS. A assinatura fica no caminho para
// que a URL termine literalmente em .mp3, como exigido pela W-API.
export const Route = createFileRoute("/api/public/tts/$audioToken")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const secret = process.env.WAPI_WEBHOOK_SECRET;
        if (!secret) return new Response("Server not configured", { status: 500 });

        const token = params.audioToken.replace(/\.mp3$/i, "");
        const separator = token.lastIndexOf(".");
        if (separator < 1) return new Response("Invalid token", { status: 400 });

        const payload = token.slice(0, separator);
        const signature = token.slice(separator + 1);
        const expected = await sha256Hex(`${secret}:${payload}`);
        if (signature !== expected) return new Response("Bad signature", { status: 401 });

        let decoded: string;
        try {
          decoded = Buffer.from(payload, "base64url").toString("utf8");
        } catch {
          return new Response("Invalid token", { status: 400 });
        }

        const splitAt = decoded.indexOf(":");
        const expiresAt = Number(decoded.slice(0, splitAt));
        const storagePath = decoded.slice(splitAt + 1);
        if (splitAt < 1 || !expiresAt || !storagePath) return new Response("Invalid token", { status: 400 });
        if (Date.now() / 1000 > expiresAt) return new Response("Expired", { status: 410 });
        if (!storagePath.startsWith("tts/") || storagePath.includes("..")) {
          return new Response("Invalid path", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage.from("crm-media").download(storagePath);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(data.stream(), {
          headers: {
            "content-type": "audio/mpeg",
            "content-length": String(data.size),
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});