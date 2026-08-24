import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tweoiunfpawwwyzezlax.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3ZW9pdW5mcGF3d3d5emV6bGF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzgxNDksImV4cCI6MjEwMzE1NDE0OX0.VvnV79vw1W5DRU9Mym1RKSanIGYabojK8UWMr232sxE";

const permissionSchema = z.object({
  can_view_all_chats: z.boolean().optional(),
  can_edit_kanban: z.boolean().optional(),
  can_manage_clients: z.boolean().optional(),
  can_manage_cases: z.boolean().optional(),
  can_send_billing: z.boolean().optional(),
  can_configure_ai: z.boolean().optional(),
  can_access_knowledge: z.boolean().optional(),
  can_manage_sectors: z.boolean().optional(),
  can_export: z.boolean().optional(),
});

const roleSchema = z.enum(["admin", "manager", "agent", "specialist"]);

/** Lista membros da conta (org_members do owner) + permissões + perfis básicos. */
export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = context.userId;

    const [{ data: members, error: memErr }, { data: perms, error: permErr }] = await Promise.all([
      context.supabase
        .from("org_members")
        .select("id, member_id, role, active, created_at")
        .eq("owner_id", owner)
        .order("created_at"),
      context.supabase.from("user_permissions").select("*").eq("owner_id", owner),
    ]);
    if (memErr) throw new Error(memErr.message);
    if (permErr) throw new Error(permErr.message);

    const memberIds = (members ?? []).map((m) => m.member_id);
    const { data: profiles, error: profErr } = memberIds.length
      ? await context.supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .in("id", memberIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[], error: null };
    if (profErr) throw new Error(profErr.message);

    return (members ?? []).map((m) => ({
      ...m,
      profile: profiles?.find((p) => p.id === m.member_id) ?? null,
      permissions: perms?.find((p) => p.user_id === m.member_id) ?? null,
    }));
  });


export const updateMemberPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; permissions: Record<string, boolean> }) =>
    z.object({ user_id: z.string().uuid(), permissions: permissionSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m } = await supabaseAdmin
      .from("org_members")
      .select("id")
      .eq("owner_id", context.userId)
      .eq("member_id", data.user_id)
      .maybeSingle();
    if (!m) throw new Error("Usuário não faz parte da sua equipe");

    const { error } = await supabaseAdmin
      .from("user_permissions")
      .upsert(
        { owner_id: context.userId, user_id: data.user_id, ...data.permissions },
        { onConflict: "owner_id,user_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; role: string }) =>
    z.object({ user_id: z.string().uuid(), role: roleSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.user_id === context.userId) throw new Error("Não é possível alterar o próprio papel");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("org_members")
      .update({ role: data.role })
      .eq("owner_id", context.userId)
      .eq("member_id", data.user_id);
    if (error) throw error;
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    return { ok: true };
  });

/** Remove membro PERMANENTEMENTE do banco. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.user_id === context.userId) throw new Error("Você não pode se remover");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pega o e-mail do usuário para limpar solicitações de acesso pendentes/aprovadas
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", data.user_id)
      .maybeSingle();
    const email = (prof as { email?: string | null } | null)?.email?.toLowerCase() ?? null;

    await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("owner_id", context.userId)
      .eq("user_id", data.user_id);

    // Remove de setores desse owner
    const { data: ownerSectors } = await supabaseAdmin
      .from("sectors")
      .select("id")
      .eq("owner_id", context.userId);
    const sectorIds = (ownerSectors ?? []).map((s: { id: string }) => s.id);
    if (sectorIds.length > 0) {
      await supabaseAdmin
        .from("sector_members")
        .delete()
        .eq("user_id", data.user_id)
        .in("sector_id", sectorIds);
    }

    // CRÍTICO: rejeita solicitações de acesso aprovadas/pendentes para este e-mail.
    // Sem isso, o RPC sync_approved_invite_for_current_user readiciona o usuário
    // no próximo login/refresh.
    if (email) {
      await supabaseAdmin
        .from("invite_access_requests")
        .update({ status: "rejected", notes: "Removido pelo admin." })
        .eq("owner_id", context.userId)
        .ilike("email", email)
        .in("status", ["approved", "pending"]);
    }

    const { error } = await supabaseAdmin
      .from("org_members")
      .delete()
      .eq("owner_id", context.userId)
      .eq("member_id", data.user_id);
    if (error) throw error;
    return { ok: true };
  });

/** Aprova um membro pendente OU reativa (active=true), respeitando o limite. */
export const approveMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("max_members")
      .eq("id", context.userId)
      .maybeSingle();
    const limit = (prof as { max_members?: number } | null)?.max_members ?? 5;
    const { count } = await supabaseAdmin
      .from("org_members")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .eq("active", true);
    if ((count ?? 0) >= limit) {
      throw new Error(`Limite de ${limit} membros ativos atingido. Aumente o limite antes de aprovar.`);
    }
    const { error } = await supabaseAdmin
      .from("org_members")
      .update({ active: true })
      .eq("owner_id", context.userId)
      .eq("member_id", data.user_id);
    if (error) throw error;
    return { ok: true };
  });

/** Desativa um membro (bloqueia o acesso sem excluir). */
export const deactivateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) =>
    z.object({ user_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.user_id === context.userId) throw new Error("Você não pode se desativar");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("org_members")
      .update({ active: false })
      .eq("owner_id", context.userId)
      .eq("member_id", data.user_id);
    if (error) throw error;
    return { ok: true };
  });

/** Ajusta o limite máximo de membros que o dono da conta pode ter ativos. */
export const setMaxMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { max_members: number }) =>
    z.object({ max_members: z.number().int().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ max_members: data.max_members })
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/* --------------------------- CONVITES --------------------------- */

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("invites")
      .select("*")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    email?: string | null;
    role: string;
    permissions: Record<string, boolean>;
    sector_ids?: string[];
    note?: string | null;
    expires_in_days?: number;
  }) =>
    z
      .object({
        email: z.string().email().nullish(),
        role: roleSchema,
        permissions: permissionSchema,
        sector_ids: z.array(z.string().uuid()).default([]),
        note: z.string().max(500).nullish(),
        expires_in_days: z.number().int().min(1).max(365).default(7),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const expires = new Date(Date.now() + data.expires_in_days * 86400_000).toISOString();
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    const rand = (n: number) =>
      Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    let slug = `${data.role}-${rand(6)}`;
    for (let i = 0; i < 3; i++) {
      const { data: exists } = await context.supabase
        .from("invites").select("id").eq("slug", slug).maybeSingle();
      if (!exists) break;
      slug = `${data.role}-${rand(6)}`;
    }

    const { data: row, error } = await context.supabase
      .from("invites")
      .insert({
        owner_id: context.userId,
        email: data.email ?? null,
        role: data.role,
        permissions: data.permissions as never,
        sector_ids: data.sector_ids,
        note: data.note ?? null,
        expires_at: expires,
        slug,
      })
      .select("token, slug, id, expires_at")
      .single();
    if (error) throw error;
    return row;
  });

/** Exclui o convite PERMANENTEMENTE do banco. */
export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invites")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/** Público: retorna dados mínimos de um convite pelo token/slug para exibir na tela de aceite. */
export const getInvitePublic = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) =>
    z.object({ token: z.string().min(4).max(120) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = data.token.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);

    let invite: any = null;
    if (isUuid) {
      const { data: row } = await supabaseAdmin.from("invites").select("*").eq("token", token).limit(1).maybeSingle();
      invite = row;
    } else {
      const { data: row } = await supabaseAdmin.from("invites").select("*").eq("slug", token).limit(1).maybeSingle();
      invite = row;
    }

    if (!invite) {
      return { valid: false as const, reason: "not_found" as const };
    }
    if (invite.revoked_at) {
      return { valid: false as const, reason: "revoked" as const };
    }
    if (invite.used_at) {
      return { valid: false as const, reason: "used" as const };
    }
    if (new Date(invite.expires_at) < new Date()) {
      return { valid: false as const, reason: "expired" as const };
    }

    const { data: ownerProfile } = await supabaseAdmin
      .from("profiles").select("full_name, email").eq("id", invite.owner_id).maybeSingle();

    return {
      valid: true as const,
      email: invite.email ?? "",
      role: invite.role ?? "agent",
      inviter_name: ownerProfile?.full_name || ownerProfile?.email || "sua equipe",
    };
  });

/**
 * Público: registra o pedido de acesso pelo link sem enviar e-mail.
 * O usuário informa o nome, recebe sessão automaticamente e fica active=FALSE até o admin ativar.
 */
export const startInviteAccess = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; full_name: string; email?: string | null }) =>
    z
      .object({
        token: z.string().min(4).max(120),
        full_name: z.string().trim().min(2).max(120),
        email: z.string().email().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const token = data.token.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);

    let invite: any = null;
    if (isUuid) {
      const { data: row } = await supabaseAdmin.from("invites").select("id, owner_id, role, expires_at, used_at, revoked_at").eq("token", token).limit(1).maybeSingle();
      invite = row;
    } else {
      const { data: row } = await supabaseAdmin.from("invites").select("id, owner_id, role, expires_at, used_at, revoked_at").eq("slug", token).limit(1).maybeSingle();
      invite = row;
    }
    if (!invite) throw new Error("Convite inválido");
    if (invite.revoked_at) throw new Error("Convite revogado");
    if (invite.used_at) throw new Error("Convite já utilizado");
    if (new Date(invite.expires_at) < new Date()) throw new Error("Convite expirado");

    const finalEmail = data.email ? data.email.trim().toLowerCase() : null;

    // Verificar se já existe solicitação
    if (finalEmail) {
      const { data: existing } = await supabaseAdmin
        .from("invite_access_requests")
        .select("id")
        .eq("invite_id", invite.id)
        .ilike("email", finalEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        await supabaseAdmin.from("invite_access_requests").update({
          full_name: data.full_name.trim() || undefined,
          token_used: token,
        }).eq("id", existing.id);

        const { data: req } = await supabaseAdmin.from("invite_access_requests").select("id, status").eq("id", existing.id).single();
        return {
          ok: true,
          request_id: existing.id,
          pending: req?.status === "pending",
          approved: req?.status === "approved",
          rejected: req?.status === "rejected",
        };
      }
    }

    const { data: requestId, error } = await supabaseAdmin.from("invite_access_requests").insert({
      invite_id: invite.id,
      owner_id: invite.owner_id,
      token_used: token,
      full_name: data.full_name.trim(),
      email: finalEmail,
      status: "pending",
    }).select("id, status").single();
    if (error) throw new Error(error.message);

    return {
      ok: true,
      request_id: requestId.id,
      pending: requestId.status === "pending",
      approved: requestId.status === "approved",
      rejected: requestId.status === "rejected",
    };
  });

/**
 * Chamado pela rota /convite/$token após o usuário logar/cadastrar.
 * Cria o vínculo com active=FALSE (pendente). O dono precisa aprovar depois.
 */
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string }) =>
    z.object({ token: z.string().min(4).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.token);
    const query = supabaseAdmin.from("invites").select("*");
    const { data: inv, error } = await (isUuid
      ? query.eq("token", data.token).maybeSingle()
      : query.eq("slug", data.token).maybeSingle());
    if (error) throw error;
    if (!inv) throw new Error("Convite inválido");
    if (inv.revoked_at) throw new Error("Convite revogado");
    if (inv.used_at) throw new Error("Convite já utilizado");
    if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Convite expirado");
    if (inv.owner_id === context.userId) throw new Error("Você é o próprio dono da conta");

    // Cria PENDENTE (active=false) — dono precisa aprovar
    await supabaseAdmin
      .from("org_members")
      .upsert(
        { owner_id: inv.owner_id, member_id: context.userId, role: inv.role, active: false },
        { onConflict: "owner_id,member_id" },
      );

    const perms = (inv.permissions ?? {}) as Record<string, boolean>;
    await supabaseAdmin
      .from("user_permissions")
      .upsert(
        {
          owner_id: inv.owner_id,
          user_id: context.userId,
          can_view_all_chats: !!perms.can_view_all_chats,
          can_edit_kanban: perms.can_edit_kanban ?? true,
          can_manage_clients: perms.can_manage_clients ?? true,
          can_manage_cases: perms.can_manage_cases ?? true,
          can_send_billing: !!perms.can_send_billing,
          can_configure_ai: !!perms.can_configure_ai,
          can_access_knowledge: perms.can_access_knowledge ?? true,
          can_manage_sectors: !!perms.can_manage_sectors,
          can_export: !!perms.can_export,
        },
        { onConflict: "owner_id,user_id" },
      );

    if (inv.sector_ids?.length) {
      const rows = inv.sector_ids.map((sid: string) => ({
        sector_id: sid,
        user_id: context.userId,
        is_lead: false,
      }));
      await supabaseAdmin.from("sector_members").upsert(rows, { onConflict: "sector_id,user_id" });
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: context.userId, role: inv.role },
        { onConflict: "user_id,role" },
      );

    await supabaseAdmin
      .from("invites")
      .update({ used_at: new Date().toISOString(), used_by: context.userId })
      .eq("id", inv.id);

    return { ok: true, owner_id: inv.owner_id, pending: true };
  });

/** Retorna contexto do usuário: dono/membro, papel, permissões, status ativo, limite. */
export const getMyOrgContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Fluxo crítico da web: não pode depender da chave privada do servidor.
    // A RPC abaixo roda no banco com o usuário autenticado, repara o perfil e libera
    // pedidos já aprovados pelo admin usando o e-mail do token de login.
    const { error: syncError } = await (context.supabase as any).rpc(
      "sync_approved_invite_for_current_user",
    );
    if (syncError) throw new Error(syncError.message);

    // Se o usuário já é dono de alguma org (tem membros sob si) OU possui role 'admin',
    // ele é sempre owner do próprio workspace e não precisa de liberação.
    const [{ data: ownsAny, error: ownsError }, { data: adminRole, error: roleError }] = await Promise.all([
      context.supabase.from("org_members").select("owner_id").eq("owner_id", context.userId).limit(1).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle(),
    ]);
    if (ownsError) throw new Error(ownsError.message);
    if (roleError) throw new Error(roleError.message);
    const forceOwner = !!ownsAny || !!adminRole;

    const { data: memRows, error: memError } = await context.supabase
      .from("org_members")
      .select("owner_id, role, active")
      .eq("member_id", context.userId)
      .order("active", { ascending: false })
      .limit(1);
    if (memError) throw new Error(memError.message);
    const mem = memRows?.[0] ?? null;

    const owner_id = forceOwner ? context.userId : (mem?.owner_id ?? context.userId);
    const isOwner = owner_id === context.userId;
    const role = isOwner ? "admin" : mem?.role ?? "agent";
    const active = isOwner ? true : mem?.active === true;

    const { data: permsRows, error: permsError } = await context.supabase
      .from("user_permissions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("owner_id", owner_id)
      .limit(1);
    if (permsError) throw new Error(permsError.message);
    const perms = permsRows?.[0] ?? null;


    const { data: prof, error: profError } = await context.supabase
      .from("profiles")
      .select("full_name, email, avatar_url, max_members")
      .eq("id", context.userId)
      .maybeSingle();
    if (profError) throw new Error(profError.message);

    return {
      owner_id,
      role,
      isOwner,
      active,
      user_id: context.userId,
      permissions: perms,
      profile: prof,
    };
  });

/** Métricas agregadas do painel admin (últimas 24h + totais). */
export const getAdminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const owner = context.userId;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [msgsAgg, activeAgg, pausedAgg, transfersAgg, sectorAgg, teamAgg] = await Promise.all([
      supabaseAdmin.from("crm_messages").select("*", { count: "exact", head: true })
        .eq("user_id", owner).gte("created_at", since),
      supabaseAdmin.from("chat_assignments").select("*", { count: "exact", head: true })
        .eq("owner_id", owner),
      supabaseAdmin.from("crm_paused_chats").select("*", { count: "exact", head: true })
        .eq("user_id", owner),
      supabaseAdmin.from("chat_transfer_log").select("*", { count: "exact", head: true })
        .eq("owner_id", owner).gte("created_at", since),
      supabaseAdmin.from("chat_assignments")
        .select("sector_id, sectors(name)")
        .eq("owner_id", owner).not("sector_id", "is", null),
      supabaseAdmin.from("org_members").select("*", { count: "exact", head: true })
        .eq("owner_id", owner).eq("active", true),
    ]);

    const bySector: Record<string, { name: string; count: number }> = {};
    for (const r of (sectorAgg.data ?? []) as Array<{ sector_id: string; sectors: { name: string } | null }>) {
      if (!r.sector_id) continue;
      bySector[r.sector_id] ??= { name: r.sectors?.name ?? "—", count: 0 };
      bySector[r.sector_id].count++;
    }

    return {
      msgsToday: msgsAgg.count ?? 0,
      activeChats: activeAgg.count ?? 0,
      pausedChats: pausedAgg.count ?? 0,
      transfers24h: transfersAgg.count ?? 0,
      teamSize: teamAgg.count ?? 0,
      bySector: Object.values(bySector).sort((a, b) => b.count - a.count),
    };
  });

/* --------------------- SOLICITAÇÕES DE ACESSO --------------------- */

export const listAccessRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("invite_access_requests")
      .select("id, invite_id, full_name, email, status, notes, created_at, token_used")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const approveAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; email?: string | null }) =>
    z.object({ id: z.string().uuid(), email: z.string().email().nullish() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("approve_invite_access_request", {
      _request_id: data.id,
      _email: data.email ?? undefined,
    });
    if (error) throw new Error(error.message);

    const payload = result as {
      ok?: boolean;
      email?: string;
      released?: boolean;
      user_id?: string | null;
    } | null;

    let released = payload?.released === true;
    let releasedUserId = payload?.user_id ?? null;
    const invited = false;
    let inviteError: string | null = null;

    // Se a conta existe no Auth mas ainda não tinha profile/vínculo, libera por aqui também.
    if (!released && payload?.email) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const finalEmail = payload.email.trim().toLowerCase();
        let authUserId: string | null = null;
        let authFullName: string | null = null;

        for (let page = 1; page <= 10 && !authUserId; page++) {
          const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (usersError) throw usersError;
          const found = usersPage.users.find((u) => u.email?.trim().toLowerCase() === finalEmail);
          if (found) {
            authUserId = found.id;
            authFullName =
              (found.user_metadata?.full_name as string | undefined) ||
              (found.user_metadata?.name as string | undefined) ||
              found.email ||
              null;
          }
          if (usersPage.users.length < 1000) break;
        }

        if (authUserId) {
          const { data: req } = await supabaseAdmin
            .from("invite_access_requests")
            .select("id, owner_id, invite_id, full_name")
            .eq("id", data.id)
            .maybeSingle();

          if (!req) throw new Error("Solicitação não encontrada após aprovação");
          if (req.owner_id === authUserId) throw new Error("O usuário aprovado é o próprio dono da conta");

          const [{ data: inv }, { data: ownerProfile }, { count: activeCount }, { data: existingMember }] = await Promise.all([
            supabaseAdmin
              .from("invites")
              .select("role, permissions, sector_ids, revoked_at, expires_at")
              .eq("id", req.invite_id)
              .maybeSingle(),
            supabaseAdmin
              .from("profiles")
              .select("max_members")
              .eq("id", req.owner_id)
              .maybeSingle(),
            supabaseAdmin
              .from("org_members")
              .select("*", { count: "exact", head: true })
              .eq("owner_id", req.owner_id)
              .eq("active", true),
            supabaseAdmin
              .from("org_members")
              .select("active")
              .eq("owner_id", req.owner_id)
              .eq("member_id", authUserId)
              .maybeSingle(),
          ]);

          if (!inv) throw new Error("Convite original não encontrado");
          if (inv.revoked_at) throw new Error("Convite original foi revogado");
          if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Convite original expirou");

          const memberLimit = (ownerProfile as { max_members?: number } | null)?.max_members ?? 5;
          if (existingMember?.active !== true && (activeCount ?? 0) >= memberLimit) {
            throw new Error(`Limite de ${memberLimit} membros ativos atingido. Aumente o limite antes de aprovar.`);
          }

          const displayName = req.full_name || authFullName || finalEmail;
          await supabaseAdmin
            .from("profiles")
            .upsert({ id: authUserId, email: finalEmail, full_name: displayName }, { onConflict: "id" });

          const { error: applyError } = await supabaseAdmin.rpc("apply_invite_membership", {
            _owner_id: req.owner_id,
            _member_id: authUserId,
            _role: inv.role ?? "agent",
            _permissions: inv.permissions ?? {},
            _sector_ids: inv.sector_ids ?? [],
            _active: true,
          });
          if (applyError) throw new Error(applyError.message);

          await supabaseAdmin
            .from("invite_access_requests")
            .update({
              status: "approved",
              email: finalEmail,
              notes: "Usuário liberado automaticamente pelo painel admin.",
            })
            .eq("id", req.id);

          released = true;
          releasedUserId = authUserId;
        }
      } catch (e) {
        inviteError = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      ok: payload?.ok ?? true,
      email: payload?.email ?? data.email ?? null,
      released,
      user_id: releasedUserId,
      invited,
      awaitingSignup: !released,
      inviteError,
    };
  });

export const getAccessRequestStatus = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("invite_access_requests")
      .select("id, full_name, email, status, notes")
      .eq("id", data.id)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) return { found: false as const };

    return {
      found: true as const,
      id: req.id,
      full_name: req.full_name,
      email: req.email,
      status: req.status,
      approved: req.status === "approved",
      rejected: req.status === "rejected",
      notes: req.notes,
    };
  });

/** Busca a solicitação mais recente por token (+email opcional) — usado pela página do convite após reload/nova aba. */
export const findAccessRequestByToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string; email?: string | null }) =>
    z
      .object({
        token: z.string().min(4).max(120),
        email: z.string().email().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("invite_access_requests")
      .select("id, full_name, email, status")
      .eq("token_used", data.token)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data.email) {
      query = query.ilike("email", data.email.trim());
    }
    const { data: req, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) return { found: false as const };
    return {
      found: true as const,
      id: req.id,
      full_name: req.full_name,
      email: req.email,
      status: req.status,
      approved: req.status === "approved",
      rejected: req.status === "rejected",
    };
  });


export const completeApprovedAccess = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string; password: string }) =>
    z.object({ id: z.string().uuid(), password: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req, error: reqError } = await supabaseAdmin
      .from("invite_access_requests")
      .select("id, owner_id, invite_id, full_name, email, status")
      .eq("id", data.id)
      .maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!req) throw new Error("Solicitação não encontrada");
    if (req.status !== "approved") throw new Error("Aguarde o administrador aprovar seu acesso");

    const finalEmail = req.email?.trim().toLowerCase() ?? "";
    if (!finalEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
      throw new Error("Solicitação aprovada sem e-mail válido");
    }

    const { data: inv, error: invError } = await supabaseAdmin
      .from("invites")
      .select("role, permissions, sector_ids, revoked_at, expires_at")
      .eq("id", req.invite_id)
      .maybeSingle();
    if (invError) throw new Error(invError.message);
    if (!inv) throw new Error("Convite original não encontrado");
    if (inv.revoked_at) throw new Error("Convite original foi revogado");
    if (new Date(inv.expires_at).getTime() < Date.now()) throw new Error("Convite original expirou");

    let authUserId: string | null = null;
    let existingConfirmed = false;
    for (let page = 1; page <= 10 && !authUserId; page++) {
      const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (usersError) throw new Error(usersError.message);
      const found = usersPage.users.find((u) => u.email?.trim().toLowerCase() === finalEmail);
      if (found) {
        authUserId = found.id;
        existingConfirmed = Boolean(found.confirmed_at || found.last_sign_in_at);
      }
      if (usersPage.users.length < 1000) break;
    }

    const displayName = req.full_name || finalEmail;
    if (authUserId) {
      // Sempre atualiza senha + confirma e-mail (mesmo se a conta já existia),
      // para o usuário conseguir entrar imediatamente com a senha que acabou de digitar.
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: displayName },
      });
      if (updateError) throw new Error(updateError.message);
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: authUserId, email: finalEmail, full_name: displayName }, { onConflict: "id" });
    } else {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: finalEmail,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: displayName },
      });
      if (createError) throw new Error(createError.message);
      authUserId = created.user?.id ?? null;
      if (!authUserId) throw new Error("Não foi possível criar o usuário");
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: authUserId, email: finalEmail, full_name: displayName }, { onConflict: "id" });
    }

    if (req.owner_id === authUserId) throw new Error("O usuário aprovado é o próprio dono da conta");

    const [{ data: ownerProfile }, { count: activeCount }, { data: existingMember }] = await Promise.all([
      supabaseAdmin.from("profiles").select("max_members").eq("id", req.owner_id).maybeSingle(),
      supabaseAdmin.from("org_members").select("*", { count: "exact", head: true }).eq("owner_id", req.owner_id).eq("active", true),
      supabaseAdmin.from("org_members").select("active").eq("owner_id", req.owner_id).eq("member_id", authUserId).maybeSingle(),
    ]);

    const memberLimit = (ownerProfile as { max_members?: number } | null)?.max_members ?? 5;
    if (existingMember?.active !== true && (activeCount ?? 0) >= memberLimit) {
      throw new Error(`Limite de ${memberLimit} membros ativos atingido. Avise o administrador.`);
    }

    const { error: applyError } = await supabaseAdmin.rpc("apply_invite_membership", {
      _owner_id: req.owner_id,
      _member_id: authUserId,
      _role: inv.role ?? "agent",
      _permissions: inv.permissions ?? {},
      _sector_ids: inv.sector_ids ?? [],
      _active: true,
    });
    if (applyError) throw new Error(applyError.message);

    await supabaseAdmin
      .from("invite_access_requests")
      .update({ notes: "Usuário finalizou o cadastro e foi liberado pela tela do convite." })
      .eq("id", req.id);

    return {
      ok: true,
      email: finalEmail,
      existingConfirmed,
      message: existingConfirmed ? "Entre com a senha já cadastrada para este e-mail." : "Acesso liberado.",
    };
  });

export const rejectAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invite_access_requests")
      .update({ status: "rejected" })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("invite_access_requests")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
