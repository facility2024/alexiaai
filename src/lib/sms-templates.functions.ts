// CRUD de templates de follow-up por SMS. Cada usuário só vê os próprios.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listSmsTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sms_followup_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

const UpsertSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(80),
  message: z.string().min(1).max(160),
  send_hour: z.number().int().min(0).max(23),
  send_minute: z.number().int().min(0).max(59),
  days_after_inactivity: z.number().int().min(0).max(30),
  active: z.boolean(),
});

export const upsertSmsTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Se ativar este, desativa os outros (regra: apenas 1 ativo por vez)
    if (data.active) {
      await context.supabase
        .from("sms_followup_templates")
        .update({ active: false })
        .eq("user_id", context.userId);
    }
    const row = { ...data, user_id: context.userId, id: data.id ?? undefined };
    const { data: saved, error } = await context.supabase
      .from("sms_followup_templates")
      .upsert(row as never)
      .select().single();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteSmsTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sms_followup_templates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
