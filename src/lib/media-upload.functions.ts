import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(200),
  base64: z.string().min(1), // data URL or raw base64
});

const MAX_BYTES = 25 * 1024 * 1024; // 25MB v1 cap

/**
 * Upload de mídia pelo operador. Grava em Bunny + media_assets.
 * Retorna o Media ID opaco.
 */
export const uploadOperatorMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => InputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { bunnyPut } = await import("@/lib/bunny.server");
    const { generateMediaId, sha256Bytes, kindFromMime } = await import("@/lib/media.server");

    // Preferir supabaseAdmin (service role). Se a env var não estiver disponível
    // no ambiente publicado (Lovable Cloud), cai para o client autenticado do
    // contexto — as RLS de media_assets permitem que o usuário grave o próprio
    // registro. Mantém o fluxo funcionando sem alterar nada mais.
    let supabaseAdmin: any = context.supabase;
    let hasServiceRole = false;
    try {
      const mod = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      mod.supabaseAdmin.rpc;
      supabaseAdmin = mod.supabaseAdmin;
      hasServiceRole = true;
    } catch (err) {
      console.warn("[uploadOperatorMedia] service role indisponível, usando client autenticado:", (err as Error)?.message);
    }

    // Com service role: grava sob o dono da org (dedupe cross-operador).
    // Sem service role: grava sob o próprio auth.uid() para satisfazer RLS.
    let ownerId = context.userId;
    if (hasServiceRole) {
      const { data: ownerRow } = await supabaseAdmin.rpc("get_org_owner", { _user_id: context.userId });
      ownerId = (ownerRow as unknown as string | null) ?? context.userId;
    }

    const clean = data.base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    } catch (e: any) {
      throw new Error(`base64 decode: ${e?.message ?? e}`);
    }
    if (bytes.byteLength === 0) throw new Error("empty file");
    if (bytes.byteLength > MAX_BYTES) throw new Error(`file too large (>${MAX_BYTES} bytes)`);

    // Detecção por magic bytes: garante que o mime/extensão real bate com o
    // conteúdo. Corrige o caso do WhatsApp recusar imagens onde a URL termina
    // em .jpg mas o arquivo real é webp/png/heic etc.
    let mime = data.mime.toLowerCase();
    let ext = (data.filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
    const b = bytes;
    const isJPEG = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const isPNG = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isGIF = b.length > 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
    const isWEBP = b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    const isPDF = b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    if (isJPEG) { mime = "image/jpeg"; ext = "jpg"; }
    else if (isPNG) { mime = "image/png"; ext = "png"; }
    else if (isGIF) { mime = "image/gif"; ext = "gif"; }
    else if (isWEBP) { mime = "image/webp"; ext = "webp"; }
    else if (isPDF) { mime = "application/pdf"; ext = "pdf"; }

    const hash = await sha256Bytes(bytes);

    // Dedupe por (owner_id, sha256)
    const { data: existing } = await supabaseAdmin
      .from("media_assets")
      .select("id")
      .eq("user_id", ownerId)
      .eq("sha256", hash)
      .eq("status", "ready")
      .maybeSingle();
    if (existing?.id) return { mediaId: existing.id, dedup: true };

    const mediaId = generateMediaId();
    const path = `${ownerId}/operator/${mediaId}.${ext}`;

    await bunnyPut(path, bytes, mime);

    const insert = await supabaseAdmin.from("media_assets").insert({
      id: mediaId,
      user_id: ownerId,
      kind: kindFromMime(mime),
      mime,
      filename: data.filename,
      size: bytes.byteLength,
      sha256: hash,
      storage_provider: "bunny",
      storage_path: path,
      status: "ready",
      origin: "operator_upload",
    });
    if (insert.error) throw new Error(`insert media_assets: ${insert.error.message}`);

    return { mediaId, dedup: false };
  });
