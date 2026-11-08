import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { processCampaignNext } from "@/lib/whatsapp-campaign-send";
import { loadWhatsappCreds } from "@/lib/whatsapp.server";

const recipientSchema = z.object({
  phone: z.string().min(8).max(30),
  display_name: z.string().trim().max(120).optional().default(""),
  consent_confirmed: z.literal(true),
  consent_source: z.enum(["manual", "spreadsheet"]),
});

async function getCampaignAccess(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: membership, error } = await supabaseAdmin
    .from("org_members")
    .select("owner_id, role, active")
    .eq("member_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (membership && (!membership.active || membership.role !== "admin")) {
    throw new Error("Somente o proprietário ou administrador ativo pode gerenciar campanhas.");
  }
  return { supabaseAdmin, ownerId: membership?.owner_id ?? userId };
}

function normalizeBrazilPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return /^55[1-9]{2}9?\d{8}$/.test(digits) ? digits : null;
}

export const listWhatsappCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { data: campaigns, error } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .select(
        "id, name, message, media_id, delay_seconds, status, created_at, started_at, completed_at, scheduled_at",
      )
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const ids = (campaigns ?? []).map((campaign) => campaign.id);
    const { data: recipients, error: recipientsError } = ids.length
      ? await supabaseAdmin
          .from("whatsapp_campaign_recipients")
          .select("campaign_id, status")
          .eq("owner_id", ownerId)
          .in("campaign_id", ids)
      : { data: [], error: null };
    if (recipientsError) throw new Error(recipientsError.message);

    const counts = new Map<string, Record<string, number>>();
    for (const recipient of recipients ?? []) {
      const current = counts.get(recipient.campaign_id) ?? {};
      current[recipient.status] = (current[recipient.status] ?? 0) + 1;
      counts.set(recipient.campaign_id, current);
    }
    return (campaigns ?? []).map((campaign) => ({
      ...campaign,
      counts: counts.get(campaign.id) ?? {},
      total: Object.values(counts.get(campaign.id) ?? {}).reduce((sum, count) => sum + count, 0),
    }));
  });

export const listWhatsappCampaignRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaign_id: string }) =>
    z.object({ campaign_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .select("id, phone, display_name, status, attempted_at, sent_at, error_message")
      .eq("owner_id", ownerId)
      .eq("campaign_id", data.campaign_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createWhatsappCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      name: string;
      message: string;
      media_id?: string | null;
      delay_seconds: number;
      scheduled_at?: string | null;
      recipients: z.infer<typeof recipientSchema>[];
    }) =>
      z
        .object({
          name: z.string().trim().min(1).max(120),
          message: z.string().trim().min(1).max(3000),
          media_id: z.string().max(40).nullish(),
          delay_seconds: z.number().int().min(30).max(600),
          scheduled_at: z.string().datetime({ offset: true }).nullish(),
          recipients: z.array(recipientSchema).min(1).max(200),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { owner_id: whatsappOwner } = await loadWhatsappCreds(supabaseAdmin, context.userId);
    if (whatsappOwner !== ownerId)
      throw new Error("A conexão WhatsApp não pertence a esta empresa.");

    const scheduledAt =
      data.scheduled_at && new Date(data.scheduled_at).getTime() > Date.now()
        ? data.scheduled_at
        : null;
    if (data.scheduled_at && !scheduledAt)
      throw new Error("O agendamento precisa estar no futuro (horário de Brasília).");

    const normalized = new Map<
      string,
      { phone: string; display_name: string; consent_source: string }
    >();
    for (const recipient of data.recipients) {
      const phone = normalizeBrazilPhone(recipient.phone);
      if (!phone) continue;
      if (!normalized.has(phone)) {
        normalized.set(phone, {
          phone,
          display_name: recipient.display_name,
          consent_source: recipient.consent_source,
        });
      }
    }
    if (normalized.size === 0) throw new Error("Nenhum telefone brasileiro válido foi informado.");

    const phones = [...normalized.keys()];
    const { data: optedOut, error: optOutError } = await supabaseAdmin
      .from("whatsapp_campaign_optouts")
      .select("phone")
      .eq("owner_id", ownerId)
      .in("phone", phones);
    if (optOutError) throw new Error(optOutError.message);
    const blocked = new Set((optedOut ?? []).map((row) => row.phone));
    const accepted = [...normalized.values()].filter((recipient) => !blocked.has(recipient.phone));
    if (accepted.length === 0)
      throw new Error("Todos os telefones informados solicitaram não receber mensagens.");

    if (data.media_id) {
      const { data: asset, error: mediaError } = await supabaseAdmin
        .from("media_assets")
        .select("id")
        .eq("id", data.media_id)
        .eq("user_id", ownerId)
        .eq("kind", "image")
        .eq("status", "ready")
        .maybeSingle();
      if (mediaError) throw new Error(mediaError.message);
      if (!asset) throw new Error("A imagem não está disponível nesta conta.");
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .insert({
        owner_id: ownerId,
        created_by: context.userId,
        name: data.name,
        message: data.message,
        media_id: data.media_id ?? null,
        delay_seconds: data.delay_seconds,
        ...(scheduledAt ? { status: "scheduled" as const, scheduled_at: scheduledAt } : {}),
      })
      .select("id")
      .single();
    if (campaignError) throw new Error(campaignError.message);

    const { error: insertError } = await supabaseAdmin.from("whatsapp_campaign_recipients").insert(
      accepted.map((recipient) => ({
        campaign_id: campaign.id,
        owner_id: ownerId,
        phone: recipient.phone,
        display_name: recipient.display_name || null,
        consent_confirmed: true,
        consent_confirmed_at: new Date().toISOString(),
        consent_confirmed_by: context.userId,
        consent_source: recipient.consent_source,
      })),
    );
    if (insertError) {
      await supabaseAdmin
        .from("whatsapp_campaigns")
        .delete()
        .eq("id", campaign.id)
        .eq("owner_id", ownerId);
      throw new Error(insertError.message);
    }

    return {
      id: campaign.id,
      recipients: accepted.length,
      skippedOptOut: blocked.size,
      scheduled_at: scheduledAt,
    };
  });

export const startWhatsappCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaign_id: string }) =>
    z.object({ campaign_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { count, error: countError } = await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("campaign_id", data.campaign_id)
      .eq("status", "queued")
      .eq("consent_confirmed", true);
    if (countError) throw new Error(countError.message);
    if (!count) throw new Error("Esta campanha não tem destinatários elegíveis na fila.");

    const { data: campaign, error } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .update({ status: "running", started_at: new Date().toISOString(), completed_at: null })
      .eq("id", data.campaign_id)
      .eq("owner_id", ownerId)
      .in("status", ["draft", "paused", "scheduled"])
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505")
        throw new Error("Já existe uma campanha em execução nesta conta.");
      throw new Error(error.message);
    }
    if (!campaign) throw new Error("A campanha não pode ser iniciada no estado atual.");
    return { ok: true };
  });

export const pauseWhatsappCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaign_id: string }) =>
    z.object({ campaign_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { error } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .update({ status: "paused" })
      .eq("id", data.campaign_id)
      .eq("owner_id", ownerId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelWhatsappCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaign_id: string }) =>
    z.object({ campaign_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    const { error } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.campaign_id)
      .eq("owner_id", ownerId)
      .in("status", ["draft", "running", "paused", "scheduled"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const processWhatsappCampaignNext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaign_id: string }) =>
    z.object({ campaign_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, ownerId } = await getCampaignAccess(context.userId);
    return processCampaignNext(supabaseAdmin, {
      ownerId,
      campaignId: data.campaign_id,
      credsUserId: context.userId,
    });
  });
