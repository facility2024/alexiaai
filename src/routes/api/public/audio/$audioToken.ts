import { createFileRoute } from "@tanstack/react-router";
import { bunnyGet, sha256Hex } from "@/lib/bunny.server";

// Proxy público assinado para áudios enviados pelo operador (armazenados no
// Bunny). A assinatura fica no caminho para que a URL termine literalmente em
// .mp3/.ogg — a W-API rejeita URL de áudio com query string após a extensão
// (mesmo padrão da rota de TTS que já funciona em produção).
export const Route = createFileRoute("/api/public/audio/$audioToken")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const secret = process.env.WAPI_WEBHOOK_SECRET;
        if (!secret) return new Response("Server not configured", { status: 500 });

        const token = params.audioToken.replace(/\.(mp3|ogg)$/i, "");
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
        if (splitAt < 1 || !expiresAt || !storagePath)
          return new Response("Invalid token", { status: 400 });
        if (Date.now() / 1000 > expiresAt) return new Response("Expired", { status: 410 });
        if (!storagePath.includes("/operator/") || storagePath.includes("..")) {
          return new Response("Invalid path", { status: 400 });
        }

        let upstream: Response;
        try {
          upstream = await bunnyGet(storagePath);
        } catch {
          return new Response("Upstream error", { status: 502 });
        }
        if (!upstream.ok || !upstream.body) return new Response("Not found", { status: 404 });

        const headers = new Headers();
        headers.set(
          "content-type",
          upstream.headers.get("content-type") ??
            (/\.ogg$/i.test(storagePath) ? "audio/ogg" : "audio/mpeg"),
        );
        const length = upstream.headers.get("content-length");
        if (length) headers.set("content-length", length);
        headers.set("cache-control", "public, max-age=3600");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
