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

export const getAiGlobalState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = await resolveOwner(context.userId);
    const { data } = await context.supabase
      .from("ai_global_state")
      .select("active, updated_at")
      .eq("owner_id", owner)
      .maybeSingle();
    return { active: data?.active ?? true, owner_id: owner };
  });

export const setAiGlobalState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { active: boolean }) =>
    z.object({ active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_global_state")
      .upsert(
        {
          owner_id: context.userId,
          active: data.active,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const pauseChatBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chat_id: string }) =>
    z.object({ chat_id: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crm_paused_chats")
      .upsert(
        { user_id: owner, chat_id: data.chat_id, paused_by: "operator" },
        { onConflict: "user_id,chat_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const resumeChatBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chat_id: string }) =>
    z.object({ chat_id: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crm_paused_chats")
      .delete()
      .eq("user_id", owner)
      .eq("chat_id", data.chat_id);
    if (error) throw error;
    return { ok: true };
  });

export const assignChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    chat_id: string;
    assigned_to?: string | null;
    sector_id?: string | null;
    reason?: string;
  }) =>
    z
      .object({
        chat_id: z.string().min(1).max(200),
        assigned_to: z.string().uuid().nullish(),
        sector_id: z.string().uuid().nullish(),
        reason: z.string().max(300).default("manual"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prev } = await supabaseAdmin
      .from("chat_assignments")
      .select("assigned_to")
      .eq("owner_id", owner)
      .eq("chat_id", data.chat_id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("chat_assignments")
      .upsert(
        {
          owner_id: owner,
          chat_id: data.chat_id,
          assigned_to: data.assigned_to ?? null,
          sector_id: data.sector_id ?? null,
          assigned_by: owner === context.userId ? "admin" : "user",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,chat_id" },
      );
    if (error) throw error;

    await supabaseAdmin.from("chat_transfer_log").insert({
      owner_id: owner,
      chat_id: data.chat_id,
      from_user: prev?.assigned_to ?? null,
      to_user: data.assigned_to ?? null,
      sector_id: data.sector_id ?? null,
      actor: context.userId,
      reason: data.reason,
    });
    return { ok: true };
  });

/** Classifica um chat pelo assunto e roteia ao lead do setor mais compatível.
 *  Chamado pelo webhook de mensagem quando não há assignment. */
export const classifyAndRouteChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chat_id: string }) =>
    z.object({ chat_id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Já tem assignment?
    const { data: existing } = await supabaseAdmin
      .from("chat_assignments")
      .select("id")
      .eq("owner_id", owner)
      .eq("chat_id", data.chat_id)
      .maybeSingle();
    if (existing) return { ok: true, already_assigned: true };

    // Últimas mensagens
    const { data: msgs } = await supabaseAdmin
      .from("crm_messages")
      .select("content, direction, created_at")
      .eq("user_id", owner)
      .eq("chat_id", data.chat_id)
      .order("created_at", { ascending: true })
      .limit(20);
    const text = (msgs ?? []).map((m) => m.content ?? "").join(" ").toLowerCase();

    const { data: sectors } = await supabaseAdmin
      .from("sectors")
      .select("id, name, keywords")
      .eq("owner_id", owner)
      .eq("active", true);

    // Pontua por keywords
    let best: { id: string; score: number } | null = null;
    for (const s of sectors ?? []) {
      const score = (s.keywords ?? []).reduce(
        (acc: number, kw: string) => acc + (text.includes(kw.toLowerCase()) ? 1 : 0),
        0,
      );
      if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
    }
    // Sem match de setor → atribui ao admin (dono da conta) por padrão
    if (!best) {
      await supabaseAdmin
        .from("chat_assignments")
        .upsert(
          {
            owner_id: owner,
            chat_id: data.chat_id,
            assigned_to: owner,
            sector_id: null,
            assigned_by: "ai",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_id,chat_id" },
        );
      await supabaseAdmin.from("chat_transfer_log").insert({
        owner_id: owner,
        chat_id: data.chat_id,
        to_user: owner,
        sector_id: null,
        actor: context.userId,
        reason: "ai-auto-route-default-admin",
      });
      return { ok: true, assigned_to: owner, default_admin: true };
    }

    // Acha o lead do setor; sem lead → cai para o admin
    const { data: lead } = await supabaseAdmin
      .from("sector_members")
      .select("user_id")
      .eq("sector_id", best.id)
      .eq("is_lead", true)
      .maybeSingle();

    const assignee = lead?.user_id ?? owner;

    await supabaseAdmin
      .from("chat_assignments")
      .upsert(
        {
          owner_id: owner,
          chat_id: data.chat_id,
          assigned_to: assignee,
          sector_id: best.id,
          assigned_by: "ai",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,chat_id" },
      );

    await supabaseAdmin.from("chat_transfer_log").insert({
      owner_id: owner,
      chat_id: data.chat_id,
      to_user: assignee,
      sector_id: best.id,
      actor: context.userId,
      reason: "ai-auto-route",
    });

    return { ok: true, sector_id: best.id, assigned_to: assignee };
  });

export const listAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = await resolveOwner(context.userId);
    const { data, error } = await context.supabase
      .from("chat_assignments")
      .select("chat_id, assigned_to, sector_id, assigned_by, updated_at")
      .eq("owner_id", owner);
    if (error) throw error;
    return data ?? [];
  });
