import { createFileRoute } from "@tanstack/react-router";
import { handlePost } from "@/routes/api/public/wapi-webhook";

// Proxy route: reuses the exact same handler logic from wapi-webhook.
// This allows the W-API to call https://crmlexia.com.br/whatsapp instead of
// the longer /api/public/wapi-webhook path.

export const Route = createFileRoute("/whatsapp")({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
      GET: async () => new Response("ok"),
    },
  },
});
