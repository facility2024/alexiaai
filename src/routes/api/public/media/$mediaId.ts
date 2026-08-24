import { createFileRoute } from "@tanstack/react-router";
import { bunnyGet, sha256Hex } from "@/lib/bunny.server";

// GET público assinado. Usado pela W-API para baixar mídia enviada pelo operador.
// URL: /api/public/media/:mediaId?exp=<unix>&sig=<hex>
// sig = sha256Hex(WAPI_WEBHOOK_SECRET + ":" + mediaId + ":" + exp)
export const Route = createFileRoute("/api/public/media/$mediaId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const secret = process.env.WAPI_WEBHOOK_SECRET;
        if (!secret) return new Response("Server not configured", { status: 500 });

        const url = new URL(request.url);
        const exp = Number(url.searchParams.get("exp") ?? 0);
        const sig = url.searchParams.get("sig") ?? "";
        if (!exp || !sig) return new Response("Missing signature", { status: 400 });
        if (Date.now() / 1000 > exp) return new Response("Expired", { status: 410 });

        // Aceita mediaId com sufixo de extensão (ex.: "<uuid>.jpg") — a W-API
        // exige que a URL termine em .png/.jpg/.jpeg para imagens.
        const mediaId = params.mediaId.replace(/\.[a-z0-9]{1,5}$/i, "");

        const expected = await sha256Hex(`${secret}:${mediaId}:${exp}`);
        if (expected !== sig) return new Response("Bad signature", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: asset } = await supabaseAdmin
          .from("media_assets")
          .select("mime, storage_path, status")
          .eq("id", mediaId)
          .maybeSingle();
        if (!asset || asset.status !== "ready" || !asset.storage_path) {
          return new Response("Not found", { status: 404 });
        }

        const upstream = await bunnyGet(asset.storage_path);
        if (!upstream.ok || !upstream.body) {
          const body = await upstream.text().catch(() => "");
          console.error("[public/media] upstream not ok", { status: upstream.status, path: asset.storage_path, body: body.slice(0, 200) });
          return new Response(`Upstream ${upstream.status}`, { status: 502 });
        }
        const headers = new Headers();
        headers.set("content-type", upstream.headers.get("content-type") ?? asset.mime ?? "application/octet-stream");
        const cl = upstream.headers.get("content-length");
        if (cl) headers.set("content-length", cl);
        headers.set("cache-control", "public, max-age=3600");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
