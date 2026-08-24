import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function resolveOwner(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from("org_members")
    .select("owner_id")
    .eq("member_id", userId)
    .eq("active", true)
    .maybeSingle();
  return data?.owner_id ?? userId;
}

export const listLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = await resolveOwner(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("chat_labels")
      .select("id, name, color, created_by, created_at")
      .eq("owner_id", owner)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

export const createLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ name: z.string().min(1).max(40), color: z.string().min(4).max(9) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("chat_labels")
      .insert({ owner_id: owner, created_by: context.userId, name: data.name, color: data.color })
      .select("id, name, color, created_by, created_at")
      .single();
    if (error) throw error;
    return row;
  });

export const deleteLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_labels").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const assignLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ chat_id: z.string().min(1), label_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const owner = await resolveOwner(context.supabase, context.userId);
    const { error } = await context.supabase.from("chat_label_assignments").insert({
      owner_id: owner,
      chat_id: data.chat_id,
      label_id: data.label_id,
      assigned_by: context.userId,
    });
    if (error && !String(error.message).includes("duplicate")) throw error;
    return { ok: true };
  });

export const unassignLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ chat_id: z.string().min(1), label_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_label_assignments")
      .delete()
      .eq("chat_id", data.chat_id)
      .eq("label_id", data.label_id);
    if (error) throw error;
    return { ok: true };
  });

export const listAllAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const owner = await resolveOwner(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("chat_label_assignments")
      .select("chat_id, label_id")
      .eq("owner_id", owner);
    if (error) throw error;
    return data ?? [];
  });
