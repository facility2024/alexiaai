import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const gatewaySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, "Use apenas letras, números, _ ou -");

export const listPaymentCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("payment_credentials")
      .select("id, gateway, display_name, api_key, environment, extra, updated_at")
      .order("gateway");
    if (error) throw error;
    return data ?? [];
  });

export const upsertPaymentCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    gateway: string;
    display_name?: string | null;
    api_key: string;
    environment?: "production" | "sandbox";
    extra?: Record<string, unknown>;
  }) =>
    z
      .object({
        gateway: gatewaySchema,
        display_name: z.string().max(120).nullish(),
        api_key: z.string().min(1).max(2048),
        environment: z.enum(["production", "sandbox"]).default("production"),
        extra: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("payment_credentials")
      .upsert(
        {
          user_id: context.userId,
          gateway: data.gateway.toLowerCase(),
          display_name: data.display_name ?? null,
          api_key: data.api_key,
          environment: data.environment,
          extra: data.extra as never,
        },
        { onConflict: "user_id,gateway" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const deletePaymentCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { gateway: string }) =>
    z.object({ gateway: gatewaySchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("payment_credentials")
      .delete()
      .eq("gateway", data.gateway.toLowerCase());
    if (error) throw error;
    return { ok: true };
  });
