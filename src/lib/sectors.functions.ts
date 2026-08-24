import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listSectors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mem } = await context.supabase
      .from("org_members")
      .select("owner_id")
      .eq("member_id", context.userId)
      .eq("active", true)
      .maybeSingle();
    const owner = mem?.owner_id ?? context.userId;

    const { data: sectors, error } = await supabaseAdmin
      .from("sectors")
      .select("*")
      .eq("owner_id", owner)
      .order("position");
    if (error) throw error;

    const ids = (sectors ?? []).map((s) => s.id);
    const { data: members } = ids.length
      ? await supabaseAdmin
          .from("sector_members")
          .select("sector_id, user_id, is_lead")
          .in("sector_id", ids)
      : { data: [] };

    return (sectors ?? []).map((s) => ({
      ...s,
      members: (members ?? []).filter((m) => m.sector_id === s.id),
    }));
  });

export const upsertSector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string;
    name: string;
    description?: string | null;
    keywords: string[];
    color?: string;
    icon?: string | null;
    position?: number;
  }) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        description: z.string().max(500).nullish(),
        keywords: z.array(z.string().min(1).max(60)).max(50),
        color: z.string().max(30).default("#8b5cf6"),
        icon: z.string().max(40).nullish(),
        position: z.number().int().default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const row = {
      owner_id: context.userId,
      name: data.name,
      description: data.description ?? null,
      keywords: data.keywords,
      color: data.color,
      icon: data.icon ?? null,
      position: data.position,
    };
    const q = data.id
      ? context.supabase.from("sectors").update(row).eq("id", data.id).eq("owner_id", context.userId)
      : context.supabase.from("sectors").insert(row);
    const { error } = await q;
    if (error) throw error;
    return { ok: true };
  });

export const deleteSector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sectors")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const setSectorMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sector_id: string; user_id: string; is_lead?: boolean; remove?: boolean }) =>
    z
      .object({
        sector_id: z.string().uuid(),
        user_id: z.string().uuid(),
        is_lead: z.boolean().default(false),
        remove: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Verifica ownership do setor
    const { data: s } = await supabaseAdmin
      .from("sectors")
      .select("owner_id")
      .eq("id", data.sector_id)
      .maybeSingle();
    if (!s || s.owner_id !== context.userId) throw new Error("Setor não encontrado");

    if (data.remove) {
      await supabaseAdmin
        .from("sector_members")
        .delete()
        .eq("sector_id", data.sector_id)
        .eq("user_id", data.user_id);
      return { ok: true };
    }

    if (data.is_lead) {
      // Zera outros leads
      await supabaseAdmin
        .from("sector_members")
        .update({ is_lead: false })
        .eq("sector_id", data.sector_id);
    }

    await supabaseAdmin
      .from("sector_members")
      .upsert(
        { sector_id: data.sector_id, user_id: data.user_id, is_lead: data.is_lead },
        { onConflict: "sector_id,user_id" },
      );
    return { ok: true };
  });
