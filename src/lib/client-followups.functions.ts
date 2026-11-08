import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizeBrPhone, validateSmsText } from "./phone-br";

export const listClientFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string }) =>
    z.object({ client_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("client_sms_followups")
      .select("id, title, message, phone, scheduled_at, status, sent_at, error, provider, created_at")
      .eq("client_id", data.client_id)
      .order("scheduled_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createClientFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    client_id?: string | null;
    title?: string | null;
    message: string;
    phone?: string | null;
    scheduled_at: string;
  }) =>
    z.object({
      client_id: z.string().uuid().nullish(),
      title: z.string().max(120).nullish(),
      message: z.string().min(1).max(160),
      phone: z.string().max(30).nullish(),
      scheduled_at: z.string().min(10),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const check = validateSmsText(data.message);
    if (!check.ok) throw new Error(check.error);

    // Descobre telefone: passado ou o do cliente
    let phone = data.phone ?? null;
    if (!phone && data.client_id) {
      const { data: c } = await context.supabase
        .from("clients").select("phone").eq("id", data.client_id).maybeSingle();
      phone = c?.phone ?? null;
    }
    const normalized = normalizeBrPhone(phone);
    if (!normalized) throw new Error("Telefone do cliente inválido ou ausente");

    const when = new Date(data.scheduled_at);
    if (Number.isNaN(when.getTime())) throw new Error("Data/hora inválida");

    const { error } = await context.supabase.from("client_sms_followups").insert({
      client_id: data.client_id ?? null,
      user_id: context.userId,
      title: data.title ?? null,
      message: data.message.trim(),
      phone: normalized,
      scheduled_at: when.toISOString(),
      status: "pending",
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Follow-ups pendentes de um telefone (chat pode não ser cliente)
export const listPhoneFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { phone: string }) =>
    z.object({ phone: z.string().min(8).max(30) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const normalized = normalizeBrPhone(data.phone);
    if (!normalized) return [];
    const { data: rows, error } = await context.supabase
      .from("client_sms_followups")
      .select("id, message, scheduled_at, status")
      .eq("phone", normalized)
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const cancelClientFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_sms_followups")
      .update({ status: "canceled" })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
