import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const providerSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, "Use apenas letras, números, _ ou -");

export const listSmsCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sms_credentials")
      .select(
        "id, provider, display_name, api_key, api_secret, sender_id, base_url, environment, extra, updated_at",
      )
      .order("provider");
    if (error) throw error;
    return data ?? [];
  });

export const upsertSmsCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    provider: string;
    display_name?: string | null;
    api_key: string;
    api_secret?: string | null;
    sender_id?: string | null;
    base_url?: string | null;
    environment?: "production" | "sandbox";
    extra?: Record<string, unknown>;
  }) =>
    z
      .object({
        provider: providerSchema,
        display_name: z.string().max(120).nullish(),
        api_key: z.string().min(1).max(2048),
        api_secret: z.string().max(2048).nullish(),
        sender_id: z.string().max(64).nullish(),
        base_url: z.string().max(300).nullish(),
        environment: z.enum(["production", "sandbox"]).default("production"),
        extra: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sms_credentials")
      .upsert(
        {
          user_id: context.userId,
          provider: data.provider.toLowerCase(),
          display_name: data.display_name ?? null,
          api_key: data.api_key,
          api_secret: data.api_secret ?? null,
          sender_id: data.sender_id ?? null,
          base_url: data.base_url ?? null,
          environment: data.environment,
          extra: data.extra as never,
        },
        { onConflict: "user_id,provider" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const deleteSmsCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: string }) =>
    z.object({ provider: providerSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sms_credentials")
      .delete()
      .eq("provider", data.provider.toLowerCase());
    if (error) throw error;
    return { ok: true };
  });
