// Server function autenticada — usada pelo botão manual do CRM.
// A lógica pesada vive em client-extract.server.ts (compartilhada com o webhook).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function resolveOwner(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mem } = await supabaseAdmin
    .from("org_members")
    .select("owner_id")
    .eq("member_id", userId).eq("active", true).maybeSingle();
  return mem?.owner_id ?? userId;
}

export const extractClientFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chat_id: string }) =>
    z.object({ chat_id: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runExtractClientFromChat } = await import("@/lib/client-extract.server");
    return runExtractClientFromChat(supabaseAdmin, owner, data.chat_id);
  });
