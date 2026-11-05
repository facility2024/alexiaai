import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function resolveOwner(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mem } = await supabaseAdmin
    .from("org_members")
    .select("owner_id")
    .eq("member_id", userId)
    .eq("active", true)
    .maybeSingle();
  return mem?.owner_id ?? userId;
}

/** Conta mensagens inbound não lidas por chat para o usuário logado. */
export const getChatUnreadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const owner = await resolveOwner(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isOwner = owner === userId;
    let canViewAll = isOwner;
    let assignedChatIds: Set<string> | null = null;

    if (!isOwner) {
      const [{ data: membership, error: membershipError }, { data: permissions, error: permissionsError }] =
        await Promise.all([
          supabaseAdmin
            .from("org_members")
            .select("active")
            .eq("owner_id", owner)
            .eq("member_id", userId)
            .maybeSingle(),
          supabaseAdmin
            .from("user_permissions")
            .select("can_view_all_chats")
            .eq("owner_id", owner)
            .eq("user_id", userId)
            .maybeSingle(),
        ]);
      if (membershipError) throw new Error(membershipError.message);
      if (permissionsError) throw new Error(permissionsError.message);
      if (!membership?.active) return {};

      canViewAll = permissions?.can_view_all_chats === true;
      if (!canViewAll) {
        const { data: assignments, error: assignmentsError } = await supabaseAdmin
          .from("chat_assignments")
          .select("chat_id")
          .eq("owner_id", owner)
          .eq("assigned_to", userId);
        if (assignmentsError) throw new Error(assignmentsError.message);
        assignedChatIds = new Set((assignments ?? []).map((assignment) => assignment.chat_id));
      }
    }

    // Carrega marcadores de leitura do usuário
    const { data: reads } = await supabaseAdmin
      .from("crm_chat_reads")
      .select("chat_id, last_read_at")
      .eq("user_id", userId)
      .eq("owner_id", owner);
    const readMap = new Map<string, string>();
    for (const r of reads ?? []) readMap.set(r.chat_id, r.last_read_at);

    // Últimas mensagens inbound (limitadas para performance)
    const { data: msgs } = await supabaseAdmin
      .from("crm_messages")
      .select("chat_id, created_at")
      .eq("user_id", owner)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(2000);

    const counts: Record<string, number> = {};
    for (const m of msgs ?? []) {
      if (!canViewAll && !assignedChatIds?.has(m.chat_id)) continue;
      const last = readMap.get(m.chat_id);
      if (!last || new Date(m.created_at) > new Date(last)) {
        counts[m.chat_id] = (counts[m.chat_id] ?? 0) + 1;
      }
    }
    return counts;
  });

/** Marca todas as mensagens de um chat como lidas para o usuário logado. */
export const markChatRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chat_id: string }) =>
    z.object({ chat_id: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const owner = await resolveOwner(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertChatAccess } = await import("@/lib/chat-access.server");
    await assertChatAccess(supabaseAdmin, userId, owner, data.chat_id);
    const { error } = await supabaseAdmin
      .from("crm_chat_reads")
      .upsert(
        {
          user_id: userId,
          owner_id: owner,
          chat_id: data.chat_id,
          last_read_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,chat_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

/** Ativa/pausa o bot para uma conversa, sempre gravando com o owner_id da
 *  organização — assim o webhook (que filtra por user_id = owner) enxerga
 *  o estado correto, mesmo quando um membro operador clica no botão. */
export const toggleChatPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chat_id: string; pause: boolean }) =>
    z.object({
      chat_id: z.string().min(1).max(200),
      pause: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const owner = await resolveOwner(userId);
    // Permissão: dono, admin (user_roles ou org_members), ou operador atribuído ao chat
    const isOwner = owner === userId;
    let isAdmin = isOwner;
    if (!isAdmin) {
      const [{ data: roleCheck }, { data: orgRole }] = await Promise.all([
        context.supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        (await import("@/integrations/supabase/client.server")).supabaseAdmin
          .from("org_members")
          .select("role")
          .eq("owner_id", owner)
          .eq("member_id", userId)
          .maybeSingle(),
      ]);
      isAdmin = Boolean(roleCheck) || (orgRole as any)?.role === "admin";
    }
    if (!isAdmin) {
      const { supabaseAdmin: adminCheck } = await import("@/integrations/supabase/client.server");
      const { data: assigned } = await adminCheck
        .from("chat_assignments")
        .select("assigned_to")
        .eq("owner_id", owner)
        .eq("chat_id", data.chat_id)
        .maybeSingle();
      if ((assigned as any)?.assigned_to === userId) isAdmin = true;
    }
    if (!isAdmin) {
      throw new Error("Somente o administrador ou o atendente do chat pode pausar/retomar o bot.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.pause) {
      const { error } = await supabaseAdmin.from("crm_paused_chats").upsert(
        { user_id: owner, chat_id: data.chat_id, paused_by: "operator" },
        { onConflict: "user_id,chat_id" },
      );
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from("crm_paused_chats")
        .delete()
        .eq("user_id", owner)
        .eq("chat_id", data.chat_id);
      if (error) throw error;
    }
    return { ok: true, paused: data.pause };
  });
