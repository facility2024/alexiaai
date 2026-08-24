import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_BYTES: Record<string, number> = {
  image: 20 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  application: 25 * 1024 * 1024,
  text: 5 * 1024 * 1024,
};

const ALLOWED_PREFIXES = ["image/", "audio/", "video/", "application/", "text/"];

function guardMime(mime: string, size: number) {
  if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
    throw new Error(`Tipo não permitido: ${mime}`);
  }
  const kind = mime.split("/")[0];
  const max = MAX_BYTES[kind] ?? 10 * 1024 * 1024;
  if (size > max) throw new Error(`Arquivo maior que o limite (${Math.round(max / 1024 / 1024)}MB)`);
}

/** Emite uma URL assinada de upload (o cliente envia bytes binários direto ao Storage). */
export const createMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string; filename: string; mime: string; size: number }) => {
    if (!d?.chatId || !d?.filename || !d?.mime || !d?.size) throw new Error("params obrigatórios");
    guardMime(d.mime, d.size);
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const safeName = data.filename.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${userId}/${data.chatId}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await supabase.storage
      .from("crm-media")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Falha ao gerar URL de upload");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

/** Retorna URL assinada de download (curta, para renderizar/baixar mídia). */
export const getMediaDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string; expiresIn?: number }) => {
    if (!d?.path) throw new Error("path obrigatório");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("crm-media")
      .createSignedUrl(data.path, data.expiresIn ?? 3600);
    if (error || !signed) throw new Error(error?.message || "Falha ao gerar URL");
    return { url: signed.signedUrl };
  });
