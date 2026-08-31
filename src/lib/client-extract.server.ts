// Núcleo compartilhado da extração de dados do cliente a partir da conversa.
// Usa supabaseAdmin (sem sessão) para poder ser chamado tanto pela serverFn
// autenticada quanto pelo webhook do WhatsApp (fire-and-forget).
// Observação: a tabela `clients` não é escopada por user_id (compartilhada
// entre autenticados). Casamento é feito por telefone/CPF.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { resolveUserAi, buildAiSdkProvider } from "@/lib/user-ai-provider.server";
import { normalizeBrPhone } from "@/lib/phone-br";

const InterestEnum = z.enum([
  "muito_alto", "alto", "medio", "baixo", "sem_interesse",
]);

const ExtractSchema = z.object({
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  cpf: z.string().nullable(),
  birth_date: z.string().nullable(),
  address_street: z.string().nullable(),
  address_number: z.string().nullable(),
  address_complement: z.string().nullable(),
  neighborhood: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  notes: z.string().nullable(),
  interest_level: InterestEnum.nullable(),
});

export type ExtractResult =
  | { ok: true; client_id: string; created: boolean; is_complete: boolean }
  | { ok: false; reason: string };

function computeComplete(row: Record<string, unknown>): boolean {
  return Boolean(
    row.full_name && row.cpf && row.phone && row.birth_date &&
    row.address_street && row.address_number && row.neighborhood &&
    row.city && row.state && row.zip,
  );
}

export async function runExtractClientFromChat(
  admin: SupabaseClient,
  ownerId: string,
  chatId: string,
): Promise<ExtractResult> {
  const { data: msgs, error: mErr } = await admin
    .from("crm_messages")
    .select("direction, content, transcription, created_at")
    .eq("user_id", ownerId)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (mErr) throw new Error(mErr.message);
  if (!msgs?.length) return { ok: false, reason: "sem mensagens" };

  const transcript = msgs
    .map((m) => {
      const who = m.direction === "inbound" ? "Cliente" : "Atendente";
      const text = (m as { transcription?: string | null; content?: string | null }).transcription
        || (m as { content?: string | null }).content
        || "";
      return text ? `${who}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);

  if (!transcript.trim()) return { ok: false, reason: "sem texto" };

  const ai = await resolveUserAi(admin, ownerId, {
    gatewayModel: "openai/gpt-5-mini",
    userOpenAiModel: "gpt-4o-mini",
  });
  const provider = buildAiSdkProvider(ai);
  const model = provider(ai.model);

  let extracted: z.infer<typeof ExtractSchema>;
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: ExtractSchema }),
      prompt:
        "Extraia dados cadastrais do cliente a partir da conversa e classifique o nível de interesse. " +
        "Retorne cada campo como string quando houver informação confiável, ou null. Não invente. " +
        "CPF: só dígitos. Telefone: só dígitos com DDD (Brasil). Data de nascimento: YYYY-MM-DD. " +
        "Estado: sigla de 2 letras. CEP: só dígitos. " +
        "interest_level: analise o tom, engajamento e intenção do cliente na conversa inteira " +
        "e escolha entre 'muito_alto', 'alto', 'medio', 'baixo', 'sem_interesse' — null se não der para julgar.\n\n" +
        "Conversa:\n" + transcript,
    });
    extracted = output;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      try { extracted = ExtractSchema.parse(JSON.parse((e as { text?: string }).text ?? "{}")); }
      catch { throw new Error("IA não retornou dados válidos"); }
    } else { throw e; }
  }

  const phone = normalizeBrPhone(extracted.phone) ?? normalizeBrPhone(chatId);
  const cpf = extracted.cpf ? extracted.cpf.replace(/\D/g, "") || null : null;
  const state = extracted.state ? extracted.state.trim().toUpperCase().slice(0, 2) : null;
  const zip = extracted.zip ? extracted.zip.replace(/\D/g, "") || null : null;

  if (!phone && !cpf && !extracted.full_name && !extracted.email) {
    return { ok: false, reason: "sem dados suficientes" };
  }

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  let existing: Record<string, unknown> | null = null;
  if (phone) {
    const { data: c } = await admin
      .from("clients")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("phone", phone)
      .maybeSingle();
    // Só reaproveita por telefone se: (a) não houver nome extraído OU
    // (b) o primeiro nome bater. Nome diferente com mesmo telefone = novo
    // cliente (ex.: mesmo WhatsApp usado por outra pessoa).
    if (c) {
      if (!extracted.full_name || !c.full_name) {
        existing = c;
      } else {
        const a = norm(String(c.full_name)).split(/\s+/)[0];
        const b = norm(extracted.full_name).split(/\s+/)[0];
        if (a && b && a === b) existing = c;
      }
    }
  }
  if (!existing && cpf) {
    const { data: c } = await admin
      .from("clients").select("*").eq("owner_id", ownerId).eq("cpf", cpf).maybeSingle();
    // Só reaproveita por CPF se (a) o primeiro nome bater e (b) o telefone
    // extraído não conflitar com o telefone já cadastrado. Caso contrário
    // trata como cliente distinto e cria novo registro.
    if (c && extracted.full_name && c.full_name) {
      const a = norm(String(c.full_name)).split(/\s+/)[0];
      const b = norm(extracted.full_name).split(/\s+/)[0];
      const phoneConflict = phone && c.phone && String(c.phone) !== phone;
      if (a && b && a === b && !phoneConflict) existing = c;
    }
  }

  function mergePatch(base: Record<string, unknown> | null) {
    const fields: Record<string, unknown> = {
      full_name: extracted.full_name,
      email: extracted.email,
      phone,
      cpf,
      birth_date: extracted.birth_date,
      address_street: extracted.address_street,
      address_number: extracted.address_number,
      address_complement: extracted.address_complement,
      neighborhood: extracted.neighborhood,
      city: extracted.city,
      state,
      zip,
      address: extracted.address_street && extracted.address_number
        ? `${extracted.address_street}, ${extracted.address_number}` : null,
      notes: extracted.notes,
    };
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v == null || v === "") continue;
      if (base && base[k]) continue;
      patch[k] = v;
    }
    if (extracted.interest_level) patch.interest_level = extracted.interest_level;
    return patch;
  }

  if (existing) {
    const patch = mergePatch(existing);
    const merged = { ...existing, ...patch };
    patch.is_complete = computeComplete(merged);
    const { error: uErr } = await admin
      .from("clients").update(patch as never).eq("id", existing.id as string);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, client_id: existing.id as string, created: false, is_complete: patch.is_complete as boolean };
  }

  const insertRow = mergePatch(null);
  insertRow.owner_id = ownerId;
  insertRow.is_complete = computeComplete(insertRow);
  const { data: created, error: iErr } = await admin
    .from("clients").insert(insertRow as never).select("id").single();
  if (iErr) throw new Error(iErr.message);
  return { ok: true, client_id: created.id, created: true, is_complete: insertRow.is_complete as boolean };
}
