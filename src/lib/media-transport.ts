import { supabase } from "@/integrations/supabase/client";
import { createMediaUploadUrl, getMediaDownloadUrl } from "@/lib/media.functions";

export interface MediaRef {
  path: string;
  mime: string;
  size: number;
  filename: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}

/**
 * Faz upload BINÁRIO (não base64) para o bucket privado `crm-media`
 * usando Signed Upload URL. Retorna o `MediaRef` para gravar em `crm_messages`.
 * Compatível com upload retomável do Storage (TUS interno).
 */
export async function uploadMedia(file: File, opts: { chatId: string }): Promise<MediaRef> {
  const { path, token } = await createMediaUploadUrl({
    data: { chatId: opts.chatId, filename: file.name, mime: file.type || "application/octet-stream", size: file.size },
  });

  // Envia o Blob binário direto (sem passar por JSON/base64).
  const { error } = await supabase.storage
    .from("crm-media")
    .uploadToSignedUrl(path, token, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;

  const meta = await extractMeta(file);
  return {
    path,
    mime: file.type || "application/octet-stream",
    size: file.size,
    filename: file.name,
    ...meta,
  };
}

/** URL assinada temporária para exibir/baixar mídia. */
export async function getMediaUrl(path: string, expiresIn = 3600): Promise<string> {
  const { url } = await getMediaDownloadUrl({ data: { path, expiresIn } });
  return url;
}

async function extractMeta(file: File): Promise<Partial<MediaRef>> {
  try {
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const meta = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      return meta;
    }
    if (file.type.startsWith("audio/") || file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith("audio/") ? "audio" : "video") as HTMLMediaElement;
      el.preload = "metadata";
      el.src = url;
      await new Promise((res, rej) => {
        el.onloadedmetadata = res;
        el.onerror = rej;
      });
      const meta: Partial<MediaRef> = { duration_ms: Math.round(el.duration * 1000) };
      if (el instanceof HTMLVideoElement) {
        meta.width = el.videoWidth;
        meta.height = el.videoHeight;
      }
      URL.revokeObjectURL(url);
      return meta;
    }
  } catch {
    // best-effort
  }
  return {};
}
