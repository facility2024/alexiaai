// Gestão de licenças SaaS (empresas) — acesso restrito ao administrador da
// plataforma (profiles.is_platform_admin). Fluxo do convite de empresa é
// público e INDEPENDENTE do convite de equipe (admin.functions.ts).
/* eslint-disable @typescript-eslint/no-explicit-any -- types.ts gerado ainda não tem company_licenses/is_platform_admin; regenerar os tipos torna os casts desnecessários */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const featuresSchema = z.record(z.string(), z.boolean());

const companyInputSchema = z.object({
  company_name: z.string().min(2).max(120),
  invited_email: z.string().email(),
  starts_at: z.string().min(4),
  ends_at: z.string().min(4).nullish(),
  features: featuresSchema.default({}),
  max_members: z.number().int().min(1).max(200).default(5),
});

type FnContext = {
  userId: string;
  supabase: any;
};

async function assertPlatformAdmin(context: FnContext): Promise<void> {
  const { data: prof, error } = await context.supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prof?.is_platform_admin) throw new Error("Acesso restrito ao administrador da plataforma");
}

function randSlug(prefix: string): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return `${prefix}-${Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("")}`;
}

/** Lista empresas licenciadas com status derivado (ativa/vencida/aguardando/desativada). */
export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context as FnContext);
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    const { data: rows, error } = await supabaseAdmin
      .from("company_licenses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ownerIds = (rows ?? [])
      .map((r: any) => r.owner_user_id)
      .filter((v: string | null) => !!v);
    const profilesById = new Map<string, { email: string | null; full_name: string | null }>();
    if (ownerIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      for (const p of profs ?? []) profilesById.set(p.id, p);
    }

    const now = Date.now();
    return (rows ?? []).map((r: any) => {
      const owner = r.owner_user_id ? profilesById.get(r.owner_user_id) : null;
      let state: string;
      if (r.status === "deleted") state = "deleted";
      else if (r.invite_used_at == null && r.owner_user_id == null) state = "pending";
      else if (new Date(r.starts_at).getTime() > now) state = "scheduled";
      else if (r.ends_at && new Date(r.ends_at).getTime() < now) state = "expired";
      else state = "active";
      return {
        ...r,
        state,
        owner_email: owner?.email ?? r.invited_email,
        owner_name: owner?.full_name ?? null,
      };
    });
  });

/** Cria a empresa + convite de empresa (link próprio, não mistura com convites de equipe). */
export const createCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.infer<typeof companyInputSchema>) => companyInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as FnContext);
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    let slug = randSlug("emp");
    for (let i = 0; i < 3; i++) {
      const { data: exists } = await supabaseAdmin
        .from("company_licenses")
        .select("id")
        .eq("invite_slug", slug)
        .maybeSingle();
      if (!exists) break;
      slug = randSlug("emp");
    }

    const { data: row, error } = await supabaseAdmin
      .from("company_licenses")
      .insert({
        company_name: data.company_name,
        invited_email: data.invited_email.trim().toLowerCase(),
        starts_at: data.starts_at,
        ends_at: data.ends_at ?? null,
        features: data.features,
        max_members: data.max_members,
        invite_slug: slug,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Edita empresa (nome, período, módulos, limite) — inclusive reativar (status). */
export const updateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      company_name?: string;
      invited_email?: string;
      starts_at?: string;
      ends_at?: string | null;
      features?: Record<string, boolean>;
      max_members?: number;
      status?: "active" | "deleted";
    }) =>
      z
        .object({
          id: z.string().uuid(),
          company_name: z.string().min(2).max(120).optional(),
          invited_email: z.string().email().optional(),
          starts_at: z.string().min(4).optional(),
          ends_at: z.string().min(4).nullable().optional(),
          features: featuresSchema.optional(),
          max_members: z.number().int().min(1).max(200).optional(),
          status: z.enum(["active", "deleted"]).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as FnContext);
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.company_name !== undefined) patch.company_name = data.company_name;
    if (data.invited_email !== undefined)
      patch.invited_email = data.invited_email.trim().toLowerCase();
    if (data.starts_at !== undefined) patch.starts_at = data.starts_at;
    if (data.ends_at !== undefined) patch.ends_at = data.ends_at;
    if (data.features !== undefined) patch.features = data.features;
    if (data.max_members !== undefined) patch.max_members = data.max_members;
    if (data.status !== undefined) patch.status = data.status;

    const { error } = await supabaseAdmin.from("company_licenses").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Desativa a empresa (soft delete) — os dados são preservados. */
export const deleteCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as FnContext);
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    const { error } = await supabaseAdmin
      .from("company_licenses")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Gera novo link de convite — só enquanto o dono ainda não concluiu o cadastro. */
export const regenerateCompanyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context as FnContext);
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    let slug = randSlug("emp");
    for (let i = 0; i < 3; i++) {
      const { data: exists } = await supabaseAdmin
        .from("company_licenses")
        .select("id")
        .eq("invite_slug", slug)
        .maybeSingle();
      if (!exists) break;
      slug = randSlug("emp");
    }

    const { data: row, error } = await supabaseAdmin
      .from("company_licenses")
      .update({
        invite_slug: slug,
        invite_used_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .is("owner_user_id", null)
      .select("invite_token, invite_slug")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Convite só pode ser reemitido antes do cadastro do dono");
    return row;
  });

/** Público: dados mínimos do convite de empresa para a tela de aceite. */
export const getCompanyInvitePublic = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => z.object({ token: z.string().min(4) }).parse(input))
  .handler(async ({ data }) => {
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    const isUuid = /^[0-9a-f-]{36}$/i.test(data.token);
    let query = supabaseAdmin.from("company_licenses").select("*");
    query = isUuid ? query.eq("invite_token", data.token) : query.eq("invite_slug", data.token);
    const { data: lic, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!lic) return { ok: false as const, reason: "Convite não encontrado" };
    if (lic.status === "deleted") return { ok: false as const, reason: "Empresa desativada" };
    if (lic.owner_user_id != null || lic.invite_used_at != null)
      return { ok: false as const, reason: "Convite já utilizado" };
    return {
      ok: true as const,
      company_name: lic.company_name as string,
      invited_email: lic.invited_email as string,
    };
  });

/**
 * Público: conclui o convite de empresa — cria (ou atualiza) a conta do dono,
 * vincula à licença e garante isolamento (remove memberships de outras orgs).
 * O trigger handle_new_user já faz o vínculo para contas NOVAS; aqui o
 * reforçamos (idempotente) para também cobrir contas já existentes.
 */
export const completeCompanyInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; full_name: string; password: string }) =>
    z
      .object({
        token: z.string().min(4),
        full_name: z.string().min(2).max(120),
        password: z.string().min(8),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // any: types.ts gerado ainda não tem company_licenses (migration pendente)
    const supabaseAdmin: any = (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin;

    const isUuid = /^[0-9a-f-]{36}$/i.test(data.token);
    let query = supabaseAdmin.from("company_licenses").select("*");
    query = isUuid ? query.eq("invite_token", data.token) : query.eq("invite_slug", data.token);
    const { data: lic, error: licError } = await query.maybeSingle();
    if (licError) throw new Error(licError.message);
    if (!lic) throw new Error("Convite não encontrado");
    if (lic.status !== "active") throw new Error("Empresa desativada");
    if (lic.owner_user_id != null || lic.invite_used_at != null)
      throw new Error("Convite já utilizado");

    const finalEmail = lic.invited_email.trim().toLowerCase();
    const displayName = data.full_name.trim() || finalEmail;

    let authUserId: string | null = null;
    for (let page = 1; page <= 10 && !authUserId; page++) {
      const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (usersError) throw new Error(usersError.message);
      const found = usersPage.users.find(
        (u: { email?: string }) => u.email?.trim().toLowerCase() === finalEmail,
      );
      if (found) authUserId = found.id;
      if (usersPage.users.length < 1000) break;
    }

    if (authUserId) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: displayName },
      });
      if (updateError) throw new Error(updateError.message);
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
    }

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: authUserId, email: finalEmail, full_name: displayName }, { onConflict: "id" });

    // Isolamento: dono de empresa não pode continuar em outras orgs
    // (nada se mistura com o painel oficial).
    await supabaseAdmin
      .from("org_members")
      .delete()
      .eq("member_id", authUserId)
      .neq("owner_id", authUserId);
    await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("user_id", authUserId)
      .neq("owner_id", authUserId);
    await supabaseAdmin.from("sector_members").delete().eq("user_id", authUserId);

    // Dono = admin do próprio workspace (forceOwner via user_roles).
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: authUserId, role: "admin" }, { onConflict: "user_id,role" });

    // Vincula a licença (idempotente — o trigger já pode ter vinculado).
    await supabaseAdmin
      .from("company_licenses")
      .update({
        owner_user_id: authUserId,
        invite_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", lic.id)
      .is("owner_user_id", null);

    return { ok: true, email: finalEmail };
  });
