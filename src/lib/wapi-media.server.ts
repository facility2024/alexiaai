import { downloadMedia, isSafeExternalUrl } from "@/lib/wapi.server";
import { bunnyPut } from "@/lib/bunny.server";
import { generateMediaId, sha256Bytes, kindFromMime } from "@/lib/media.server";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/webm": "webm", "audio/wav": "wav",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "application/pdf": "pdf", "application/zip": "zip",
};

export interface MediaMeta {
  type?: string | null;
  mimetype?: string | null;
  filename?: string | null;
  mediaKey?: string | null;
  directPath?: string | null;
  url?: string | null;
  fileEncSha256?: string | null;
  fileSha256?: string | null;
  messageId?: string | null;
  phone?: string | null;
}

/** Extract media metadata from a W-API webhook payload. */
export function extractMediaMeta(payload: any, wapiMessageId: string | null, phone: string | null): MediaMeta | null {
  const msg = payload?.message ?? payload?.msg ?? payload;
  const mc = msg?.msgContent ?? payload?.msgContent ?? msg ?? {};
  let node: any = null;
  let type: string | null = null;
  if (mc?.imageMessage)    { node = mc.imageMessage;    type = "image"; }
  else if (mc?.videoMessage)    { node = mc.videoMessage;    type = "video"; }
  else if (mc?.audioMessage)    { node = mc.audioMessage;    type = "audio"; }
  else if (mc?.documentMessage) { node = mc.documentMessage; type = "document"; }
  else if (mc?.stickerMessage)  { node = mc.stickerMessage;  type = "sticker"; }
  if (!node) return null;
  return {
    type,
    mimetype: node.mimetype ?? node.mime ?? node.contentType ?? null,
    filename: node.fileName ?? node.filename ?? node.title ?? null,
    mediaKey: node.mediaKey ?? null,
    directPath: node.directPath ?? null,
    url: node.url ?? node.mediaUrl ?? null,
    fileEncSha256: node.fileEncSha256 ?? null,
    fileSha256: node.fileSha256 ?? null,
    messageId: wapiMessageId,
    phone,
  };
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      mime: r.headers.get("content-type"),
    };
  } catch { return null; }
}

/** Attempt to download+store media. Returns storage info on success, or an error message. */
export async function tryDownloadAndStore(opts: {
  supabaseAdmin: any;
  instanceId: string;
  apiToken: string;
  userId: string;
  chatId: string;
  meta: MediaMeta;
}): Promise<
  | { ok: true; media_id: string; storage_path: string; mime: string | null; size: number; filename: string | null }
  | { ok: false; error: string }
> {
  const { supabaseAdmin, instanceId, apiToken, userId, chatId, meta } = opts;
  try {
    let bytes: Uint8Array | null = null;
    let mime: string | null = meta.mimetype ?? null;

    // Direct absolute URL (rare — WhatsApp media is usually encrypted)
    if (meta.url && /^https?:\/\//i.test(meta.url) && isSafeExternalUrl(meta.url)) {
      const r = await fetchBytes(meta.url);
      if (r) { bytes = r.bytes; mime = mime ?? r.mime; }
    }

    // W-API download-media (decrypts encrypted WA media)
    if (!bytes) {
      const dl = await downloadMedia(instanceId, apiToken, {
        mediaKey: meta.mediaKey,
        directPath: meta.directPath,
        type: meta.type,
        mimetype: meta.mimetype,
        messageId: meta.messageId,
        phone: meta.phone,
      });
      const body: any = dl.body ?? {};
      if (!dl.ok) {
        return { ok: false, error: `download-media ${dl.status}: ${(body?.message ?? body?.error ?? JSON.stringify(body)).toString().slice(0, 200)}` };
      }
      const link: string | null = body.fileLink ?? body.url ?? body.mediaUrl ?? body.link ?? null;
      const b64: string | null = body.base64 ?? body.fileBase64 ?? body.data ?? null;
      mime = mime ?? body.mimetype ?? body.mime ?? null;
      if (link && isSafeExternalUrl(link)) {
        const r = await fetchBytes(link);
        if (r) { bytes = r.bytes; mime = mime ?? r.mime; }
        else return { ok: false, error: "fetch fileLink failed" };
      } else if (b64) {
        const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
        try { bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)); }
        catch (e: any) { return { ok: false, error: `base64 decode: ${e?.message ?? e}` }; }
      } else {
        return { ok: false, error: "no fileLink or base64 in response" };
      }
    }

    if (!bytes || bytes.byteLength === 0) return { ok: false, error: "empty bytes" };

    const ext = (mime && EXT_BY_MIME[mime.toLowerCase()])
      ?? (meta.filename?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase())
      ?? "bin";
    const hash = await sha256Bytes(bytes);

    // Dedupe by (user_id, sha256)
    const { data: existing } = await supabaseAdmin
      .from("media_assets")
      .select("id, storage_path, mime, size, filename")
      .eq("user_id", userId)
      .eq("sha256", hash)
      .eq("status", "ready")
      .maybeSingle();
    if (existing?.id) {
      return {
        ok: true,
        media_id: existing.id,
        storage_path: existing.storage_path ?? "",
        mime: existing.mime ?? mime,
        size: existing.size ?? bytes.byteLength,
        filename: existing.filename ?? meta.filename ?? null,
      };
    }

    const mediaId = generateMediaId();
    const path = `${userId}/${chatId}/${mediaId}.${ext}`;

    try {
      await bunnyPut(path, bytes, mime);
    } catch (e: any) {
      return { ok: false, error: `bunny upload: ${e?.message ?? e}` };
    }

    const insert = await supabaseAdmin.from("media_assets").insert({
      id: mediaId,
      user_id: userId,
      kind: kindFromMime(mime),
      mime,
      filename: meta.filename ?? null,
      size: bytes.byteLength,
      sha256: hash,
      storage_provider: "bunny",
      storage_path: path,
      status: "ready",
      origin: "wapi_inbound",
    });
    if (insert.error) {
      return { ok: false, error: `insert media_assets: ${insert.error.message}` };
    }

    return { ok: true, media_id: mediaId, storage_path: path, mime, size: bytes.byteLength, filename: meta.filename ?? null };
  } catch (e: any) {
    return { ok: false, error: `exception: ${e?.message ?? e}` };
  }
}

/** Process a single crm_messages row that has media_status pending/failed_retry. */
export async function processPendingMediaRow(supabaseAdmin: any, row: any): Promise<void> {
  const meta: MediaMeta | undefined = row?.raw?.media_meta;
  if (!meta) {
    await supabaseAdmin.from("crm_messages").update({
      media_status: "failed",
      media_last_error: "missing media_meta",
    }).eq("id", row.id);
    return;
  }
  const { data: cfg } = await supabaseAdmin
    .from("wapi_config")
    .select("instance_id, api_token")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!cfg) {
    await supabaseAdmin.from("crm_messages").update({
      media_status: "failed",
      media_last_error: "no wapi_config for user",
    }).eq("id", row.id);
    return;
  }

  await supabaseAdmin.from("crm_messages").update({ media_status: "processing" }).eq("id", row.id);

  const result = await tryDownloadAndStore({
    supabaseAdmin,
    instanceId: (cfg as any).instance_id,
    apiToken: (cfg as any).api_token,
    userId: row.user_id,
    chatId: row.chat_id,
    meta,
  });

  const attempts = (row.media_attempts ?? 0) + 1;
  if (result.ok) {
    await supabaseAdmin.from("crm_messages").update({
      media_id: result.media_id,
      storage_path: result.storage_path,
      mime: result.mime,
      size: result.size,
      filename: result.filename,
      media_status: "completed",
      media_attempts: attempts,
      media_last_error: null,
      media_next_retry_at: null,
    }).eq("id", row.id);
  } else {
    const maxAttempts = 8;
    const done = attempts >= maxAttempts;
    // Progressive backoff: 1m, 2m, 5m, 10m, 20m, 40m, 60m
    const backoffMin = [1, 2, 5, 10, 20, 40, 60][Math.min(attempts - 1, 6)];
    await supabaseAdmin.from("crm_messages").update({
      media_status: done ? "failed" : "failed_retry",
      media_attempts: attempts,
      media_last_error: result.error.slice(0, 500),
      media_next_retry_at: done ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
    }).eq("id", row.id);
  }
}
