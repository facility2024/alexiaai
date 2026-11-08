import {
  getWapiError,
  loadWhatsappCreds,
  parseWapiConnection,
  WAPI_BASE,
} from "@/lib/whatsapp.server";

export type CampaignNextResult = {
  status: string;
  wait_ms?: number;
  message?: string;
  recipient_id?: string;
  phone?: string;
  display_name?: string;
};

// Claim do próximo destinatário da fila + envio via W-API.
// Compartilhado entre o server fn autenticado e o cron público de campanhas.
export async function processCampaignNext(
  supabaseAdmin: any,
  opts: { ownerId: string; campaignId: string; credsUserId: string },
): Promise<CampaignNextResult> {
  const { ownerId, campaignId, credsUserId } = opts;
  const { data: claim, error: claimError } = await supabaseAdmin.rpc(
    "claim_whatsapp_campaign_recipient",
    { _owner_id: ownerId, _campaign_id: campaignId },
  );
  if (claimError) throw new Error(claimError.message);
  if (claim?.status !== "claimed") return (claim ?? { status: "unknown" }) as CampaignNextResult;

  const recipientId = String(claim.recipient_id);
  const finish = async (result: {
    status: "sent" | "failed";
    error_message?: string | null;
    wapi_message_id?: string | null;
  }) => {
    const { error } = await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .update({
        status: result.status,
        processing_at: null,
        sent_at: result.status === "sent" ? new Date().toISOString() : null,
        error_message: result.error_message ?? null,
        wapi_message_id: result.wapi_message_id ?? null,
      })
      .eq("id", recipientId)
      .eq("owner_id", ownerId)
      .eq("status", "sending");
    if (error) throw new Error(error.message);
    return { status: result.status };
  };

  try {
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(
      supabaseAdmin,
      credsUserId,
    );
    if (owner_id !== ownerId) throw new Error("A conexão WhatsApp pertence a outra conta.");
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("whatsapp_campaigns")
      .select("message, media_id")
      .eq("id", campaignId)
      .eq("owner_id", ownerId)
      .single();
    if (campaignError) throw new Error(campaignError.message);

    const statusResponse = await fetch(
      `${WAPI_BASE}/instance/status-instance?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` }, signal: AbortSignal.timeout(15000) },
    );
    const statusBody = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok || !parseWapiConnection(statusBody).connected) {
      await supabaseAdmin
        .from("whatsapp_campaign_recipients")
        .update({ status: "queued", processing_at: null, attempted_at: null })
        .eq("id", recipientId)
        .eq("owner_id", ownerId);
      await supabaseAdmin
        .from("whatsapp_campaigns")
        .update({ status: "paused" })
        .eq("id", campaignId)
        .eq("owner_id", ownerId);
      return {
        status: "disconnected",
        message: getWapiError(statusBody, statusResponse.status),
      };
    }

    const displayName = String(claim.display_name ?? "").trim();
    const fullName = displayName || "cliente";
    const firstName = displayName.split(/\s+/)[0] || "cliente";
    const personalized = campaign.message
      .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
      .replace(/\{\{\s*nome\s*\}\}/gi, fullName);
    const footer = "\n\nPara não receber mais mensagens, responda SAIR.";
    const content = `${personalized.trim()}${footer}`;
    let endpoint = "send-text";
    let payload: Record<string, unknown> = {
      phone: claim.phone,
      message: content,
      delayMessage: 0,
    };
    let messageType = "text";
    let mime: string | null = null;
    let filename: string | null = null;

    if (campaign.media_id) {
      const { data: asset, error: assetError } = await supabaseAdmin
        .from("media_assets")
        .select("storage_path, mime, filename, status, kind")
        .eq("id", campaign.media_id)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (assetError) throw new Error(assetError.message);
      if (!asset?.storage_path || asset.status !== "ready" || asset.kind !== "image") {
        throw new Error("A imagem da campanha não está disponível.");
      }
      const { bunnySignedUrl } = await import("@/lib/bunny.server");
      const imageUrl = await bunnySignedUrl(asset.storage_path, { ttlSeconds: 3600 });
      endpoint = "send-image";
      messageType = "image";
      mime = asset.mime;
      filename = asset.filename;
      payload = {
        phone: claim.phone,
        image: imageUrl,
        caption: content,
        fileName: asset.filename ?? "campanha.jpg",
        delayMessage: 0,
      };
    }

    const response = await fetch(
      `${WAPI_BASE}/message/${endpoint}?instanceId=${encodeURIComponent(instance_id)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      },
    );
    const responseBody = await response.json().catch(() => ({}));
    const apiError = responseBody?.error || responseBody?.success === false;
    if (!response.ok || apiError) {
      return await finish({
        status: "failed",
        error_message: getWapiError(responseBody, response.status),
      });
    }

    const messageId = responseBody?.messageId ?? responseBody?.id ?? responseBody?.key?.id ?? null;
    const { error: logError } = await supabaseAdmin.from("crm_messages").insert({
      user_id: ownerId,
      chat_id: claim.phone,
      direction: "outbound",
      sender: "operator",
      message_type: messageType,
      content,
      media_id: campaign.media_id,
      mime,
      filename,
      wapi_message_id: messageId,
      status: "sent",
      raw: { campaign_id: campaignId, messageId },
    });
    if (logError) console.error("[whatsapp-campaign] CRM log failed:", logError.message);
    return await finish({ status: "sent", wapi_message_id: messageId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida no envio.";
    return await finish({ status: "failed", error_message: message.slice(0, 500) });
  }
}
