import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Lista cobranças do usuário (com filtro por card opcional)
export const listBillings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId?: string }) =>
    z.object({ cardId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("billings").select("*")
      .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(100);
    if (data.cardId) q = q.eq("card_id", data.cardId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Cria cobrança manual (sem gateway) — útil pra registrar no sistema
export const createManualBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    cardId?: string; clientId?: string; amount: number;
    description?: string; dueDate?: string;
  }) => z.object({
    cardId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    amount: z.number().positive(),
    description: z.string().max(400).optional(),
    dueDate: z.string().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: b, error } = await context.supabase.from("billings").insert({
      user_id: context.userId,
      card_id: data.cardId ?? null,
      client_id: data.clientId ?? null,
      gateway: "manual",
      amount: data.amount,
      description: data.description ?? null,
      due_date: data.dueDate ?? null,
      status: "pending",
    }).select("*").single();
    if (error) throw new Error(error.message);
    return b;
  });
