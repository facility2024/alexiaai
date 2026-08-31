import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============================================================
// TEMPLATES
// ============================================================

export const listTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { data, error } = await context.supabase
      .from("contract_templates")
      .select("*")
      .eq("owner_id", owner_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  body_html: z.string().default(""),
  variables: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  source_pdf_path: z.string().optional().nullable(),
});

export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertTemplateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;

    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("contract_templates")
        .update({
          name: data.name,
          description: data.description ?? null,
          body_html: data.body_html,
          variables: data.variables,
          active: data.active,
          ...(data.source_pdf_path !== undefined ? { source_pdf_path: data.source_pdf_path } : {}),
        })
        .eq("id", data.id)
        .eq("owner_id", owner_id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: row, error } = await context.supabase
      .from("contract_templates")
      .insert({
        owner_id,
        created_by: context.userId,
        name: data.name,
        description: data.description ?? null,
        body_html: data.body_html,
        variables: data.variables,
        active: data.active,
        ...(data.source_pdf_path ? { source_pdf_path: data.source_pdf_path } : {}),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const duplicateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { data: src, error } = await context.supabase
      .from("contract_templates")
      .select("*")
      .eq("id", data.id)
      .eq("owner_id", owner_id)
      .single();
    if (error) throw new Error(error.message);
    if (src.owner_id !== owner_id) throw new Error("Sem permissão para duplicar este template");
    const { data: row, error: insErr } = await context.supabase
      .from("contract_templates")
      .insert({
        owner_id: src.owner_id,
        created_by: context.userId,
        name: `${src.name} (cópia)`,
        description: src.description,
        body_html: src.body_html,
        variables: src.variables,
        active: false,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return row;
  });

export const toggleTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { error } = await context.supabase
      .from("contract_templates")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("owner_id", owner_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// CONTRACTS
// ============================================================

export const listContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { data, error } = await context.supabase
      .from("contracts")
      .select("*, contract_signers(*)")
      .eq("owner_id", owner_id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getContract = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { data: row, error } = await context.supabase
      .from("contracts")
      .select("*, contract_signers(*), contract_events(*)")
      .eq("id", data.id)
      .eq("owner_id", owner_id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---- helpers ----
function renderTemplate(html: string, values: Record<string, string | number | null | undefined>): string {
  return html.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key];
    return v === null || v === undefined ? `{{${key}}}` : String(v);
  });
}

function findMissingVariables(html: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

const createDraftSchema = z.object({
  client_id: z.string().uuid(),
  template_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
  payment_method: z.string().optional(),
  message: z.string().optional(),
});

export const createContractDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createDraftSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;

    const [clientRes, templateRes, profileRes] = await Promise.all([
      context.supabase.from("clients").select("*").eq("id", data.client_id).single(),
      context.supabase.from("contract_templates").select("*").eq("id", data.template_id).single(),
      context.supabase.from("profiles").select("*").eq("id", context.userId).single(),
    ]);
    if (clientRes.error) throw new Error(clientRes.error.message);
    if (templateRes.error) throw new Error(templateRes.error.message);
    const client = clientRes.data;
    const template = templateRes.data;
    const agent = profileRes.data;

    // valores automáticos a partir do cliente/agente + valores fornecidos
    const autoValues: Record<string, string | number | null | undefined> = {
      "cliente.nome": client.full_name,
      "cliente.cpf": client.cpf,
      "cliente.email": client.email,
      "cliente.telefone": client.phone,
      "cliente.endereco": [client.address_street, client.address_number, client.neighborhood, client.city, client.state]
        .filter(Boolean)
        .join(", "),
      "cliente.cidade": client.city,
      "cliente.estado": client.state,
      "agente.nome": agent?.full_name,
      "agente.email": agent?.email,
      "hoje": new Date().toLocaleDateString("pt-BR"),
      ...data.values,
    };

    const { data: row, error } = await context.supabase
      .from("contracts")
      .insert({
        owner_id,
        created_by: context.userId,
        client_id: data.client_id,
        template_id: data.template_id,
        responsible_agent_id: context.userId,
        title: data.title ?? template.name,
        message: data.message ?? null,
        payment_method: data.payment_method ?? null,
        values: autoValues,
        status: "draft",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---- auditoria IA ----
export const runContractAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .select("*, contract_templates(body_html, name)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const tpl = (contract as unknown as { contract_templates: { body_html: string; name: string } }).contract_templates;
    const rendered = renderTemplate(tpl.body_html, (contract.values ?? {}) as Record<string, string>);
    const missing = findMissingVariables(rendered);

    const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured — configure BYOK ou env");

    const prompt = `Você é um auditor jurídico. Avalie o contrato abaixo em:
- clareza (0-25)
- completude de cláusulas essenciais (0-25)
- riscos jurídicos (0-25)
- adequação ao direito brasileiro (0-25)

Responda APENAS JSON no formato:
{"score": 0-100, "issues": [{"severity":"low|medium|high","area":"...","message":"..."}], "summary":"..."}

Contrato:
"""${rendered.slice(0, 12000)}"""`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é um auditor jurídico brasileiro. Retorne SOMENTE JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    type Issue = { severity: string; area: string; message: string };
    let parsed: { score?: number; issues?: Issue[]; summary?: string } = {};
    try {
      parsed = JSON.parse(clean) as { score?: number; issues?: Issue[]; summary?: string };
    } catch {
      parsed = { score: 0, issues: [{ severity: "high", area: "parser", message: "IA retornou JSON inválido" }], summary: raw.slice(0, 500) };
    }

    const report = { ...parsed, missing_variables: missing, audited_at: new Date().toISOString() };
    const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));

    await context.supabase
      .from("contracts")
      .update({
        integrity_score: score,
        integrity_report: report as unknown as never,
        status: score >= 80 && missing.length === 0 ? "ready" : "review",
      })
      .eq("id", data.id);

    return { score, report: report as { score?: number; issues?: Issue[]; summary?: string; missing_variables: string[]; audited_at: string } };
  });

// ---- envio para Autentique ----
const SCORE_THRESHOLD = 80;

const sendSchema = z.object({
  id: z.string().uuid(),
  signers: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
      }),
    )
    .min(1),
});

export const sendContractToAutentique = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .select("*, contract_templates(body_html, name)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    if ((contract.integrity_score ?? 0) < SCORE_THRESHOLD) {
      throw new Error(`Auditoria IA abaixo de ${SCORE_THRESHOLD}. Revise antes de enviar.`);
    }

    const tpl = (contract as unknown as { contract_templates: { body_html: string; name: string } }).contract_templates;
    const rendered = renderTemplate(tpl.body_html, (contract.values ?? {}) as Record<string, string>);
    const missing = findMissingVariables(rendered);
    if (missing.length > 0) {
      throw new Error(`Variáveis não preenchidas: ${missing.join(", ")}`);
    }

    const { renderContractPdf } = await import("./contracts-pdf.server");
    const { autentiqueCreateDocument } = await import("./autentique.server");

    const pdf = await renderContractPdf({ title: contract.title ?? tpl.name, body: rendered });
    const doc = await autentiqueCreateDocument({
      name: contract.title ?? tpl.name,
      pdf,
      signers: data.signers.map((s) => ({ email: s.email, name: s.name, action: "SIGN" })),
      message: contract.message ?? undefined,
    });

    // grava id + signatários
    await context.supabase
      .from("contracts")
      .update({
        autentique_document_id: doc.id,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (doc.signatures?.length) {
      const rows = doc.signatures.map((s, i) => ({
        contract_id: data.id,
        owner_id: contract.owner_id,
        name: s.name ?? s.email ?? "Signatário",
        email: s.email ?? "",
        action: s.action?.name ?? "SIGN",
        status: "pending",
        autentique_signer_id: s.public_id ?? null,
        signing_url: s.link?.short_link ?? null,
        position: i,
      }));
      await context.supabase.from("contract_signers").insert(rows);
    }

    return { ok: true, autentique_document_id: doc.id };
  });

export const cancelContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .select("autentique_document_id")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    if (contract.autentique_document_id) {
      const { autentiqueDeleteDocument } = await import("./autentique.server");
      try {
        await autentiqueDeleteDocument(contract.autentique_document_id);
      } catch (e) {
        console.error("autentiqueDeleteDocument", e);
      }
    }
    await context.supabase.from("contracts").update({ status: "cancelled" }).eq("id", data.id);
    return { ok: true };
  });

export const resendContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: contract, error } = await context.supabase
      .from("contracts")
      .select("autentique_document_id, contract_signers(autentique_signer_id, status)")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if (!contract.autentique_document_id) throw new Error("Contrato ainda não enviado");

    const pending = ((contract.contract_signers ?? []) as Array<{ status: string; autentique_signer_id: string | null }>)
      .filter((s) => s.status !== "signed" && !!s.autentique_signer_id)
      .map((s) => s.autentique_signer_id as string);

    if (pending.length === 0) return { ok: true, resent: 0 };

    const { autentiqueResendSignatures } = await import("./autentique.server");
    await autentiqueResendSignatures(contract.autentique_document_id, pending);
    return { ok: true, resent: pending.length };
  });

// ============================================================
// REMINDERS (Etapa 6 — leitura isolada para UI)
// ============================================================

export const listContractReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contract_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("contract_reminders")
      .select("id, level, sent_at")
      .eq("contract_id", data.contract_id)
      .order("sent_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============================================================
// EDUARDO — agente da etapa Contrato do Kanban
// Cria o rascunho a partir do template ativo mais adequado ao
// caso (por área jurídica quando possível), roda a auditoria de IA
// e devolve o id do contrato para o advogado revisar e enviar.
// ============================================================

export const runEduardoForCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ card_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // 1. Card do Kanban
    const { data: card, error: cardErr } = await context.supabase
      .from("kanban_cards")
      .select("id, contact_phone, contact_name, chat_id, legal_area, summary")
      .eq("id", data.card_id)
      .single();
    if (cardErr) throw new Error(cardErr.message);

    // 2. Cliente (por telefone; fallback pelo chat_id)
    const phone = card.contact_phone ?? card.chat_id;
    if (!phone) throw new Error("Card sem telefone/chat_id — cadastre o cliente antes.");

    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("*")
      .or(`phone.eq.${phone},phone.eq.${phone.replace(/\D/g, "")}`)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Cliente ainda não cadastrado a partir deste atendimento.");

    // 3. Escolhe template: prefere um cujo nome contenha a área jurídica; senão o mais recente ativo.
    const { data: templates, error: tplErr } = await context.supabase
      .from("contract_templates")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (tplErr) throw new Error(tplErr.message);
    if (!templates?.length) throw new Error("Nenhum template de contrato ativo. Cadastre um em Contratos → Templates.");

    const area = (card.legal_area ?? "").toLowerCase();
    const picked =
      (area && templates.find((t) => t.name.toLowerCase().includes(area))) || templates[0];

    // 4. Cria o rascunho reutilizando a lógica de valores automáticos
    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;
    const { data: agent } = await context.supabase.from("profiles").select("*").eq("id", context.userId).single();

    const autoValues: Record<string, string | number | null | undefined> = {
      "cliente.nome": client.full_name,
      "cliente.cpf": client.cpf,
      "cliente.email": client.email,
      "cliente.telefone": client.phone,
      "cliente.endereco": [client.address_street, client.address_number, client.neighborhood, client.city, client.state]
        .filter(Boolean)
        .join(", "),
      "cliente.cidade": client.city,
      "cliente.estado": client.state,
      "caso.area": card.legal_area,
      "caso.resumo": card.summary,
      "agente.nome": agent?.full_name,
      "agente.email": agent?.email,
      "hoje": new Date().toLocaleDateString("pt-BR"),
    };

    const { data: contract, error: insErr } = await context.supabase
      .from("contracts")
      .insert({
        owner_id,
        created_by: context.userId,
        client_id: client.id,
        template_id: picked.id,
        responsible_agent_id: context.userId,
        title: picked.name,
        values: autoValues,
        status: "draft",
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    // 5. Auditoria de IA reutiliza a mesma lógica em contract_templates
    const rendered = renderTemplate(picked.body_html ?? "", autoValues as Record<string, string>);
    const missing = findMissingVariables(rendered);

    const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
    let score = 0;
    let report: Record<string, unknown> = { missing_variables: missing, audited_at: new Date().toISOString() };
    if (apiKey && rendered) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Você é um auditor jurídico brasileiro. Retorne SOMENTE JSON válido." },
            {
              role: "user",
              content: `Avalie o contrato abaixo (clareza, completude, riscos, adequação). Responda JSON: {"score":0-100,"issues":[{"severity":"low|medium|high","area":"...","message":"..."}],"summary":"..."}\n\n"""${rendered.slice(0, 12000)}"""`,
            },
          ],
          temperature: 0.2,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const raw = j.choices?.[0]?.message?.content ?? "{}";
        const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        try {
          const parsed = JSON.parse(clean) as { score?: number; issues?: unknown; summary?: string };
          score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));
          report = { ...parsed, missing_variables: missing, audited_at: new Date().toISOString() };
        } catch {
          report = { score: 0, summary: raw.slice(0, 500), missing_variables: missing, audited_at: new Date().toISOString() };
        }
      }
    }

    await context.supabase
      .from("contracts")
      .update({
        integrity_score: score,
        integrity_report: report as unknown as never,
        status: score >= 80 && missing.length === 0 ? "ready" : "review",
      })
      .eq("id", contract.id);

    return {
      contract_id: contract.id as string,
      template_name: picked.name as string,
      score,
      missing,
    };
  });

// ============================================================
// EDUARDO — envio do rascunho, aprovação e handoff (isolado)
// Cada função usa APENAS a tabela nova eduardo_contract_reviews
// e chamadas às tabelas existentes em modo leitura, exceto o
// handoff que troca kanban_cards.ai_enabled para false — coluna
// que já existe e apenas muda de valor.
// ============================================================

async function loadEduardoContext(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  contractId: string,
) {
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, owner_id, client_id, title, values, integrity_score")
    .eq("id", contractId)
    .single();
  if (error) throw new Error(error.message);
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .eq("id", contract.client_id)
    .single();
  if (cErr) throw new Error(cErr.message);
  return { contract, client };
}

export const eduardoSendDraftToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      contract_id: z.string().uuid(),
      card_id: z.string().uuid().optional(),
      custom_message: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { contract, client } = await loadEduardoContext(context.supabase, data.contract_id);
    if (!client.phone) throw new Error("Cliente sem telefone cadastrado.");

    const { data: wapi, error: wErr } = await context.supabase
      .from("wapi_config")
      .select("instance_id, api_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (wErr) throw new Error(wErr.message);
    if (!wapi?.instance_id || !wapi?.api_token)
      throw new Error("WhatsApp (W-API) não configurado nas Integrações.");

    const message =
      data.custom_message ??
      `Olá ${client.full_name?.split(" ")[0] ?? ""}! Sou o Eduardo, agente de contratos do escritório. ` +
      `Preparei o rascunho do seu contrato "${contract.title}" para sua revisão. ` +
      `Assim que estiver tudo certo do seu lado, é só me responder "OK" que seguimos com a assinatura. ` +
      `Se quiser ajustar algo, me diga aqui mesmo.`;

    const { sendText } = await import("@/lib/wapi.server");
    const res = await sendText(wapi.instance_id, wapi.api_token, client.phone, message);
    if (!res.ok) throw new Error(`W-API falhou (${res.status}): ${JSON.stringify(res.body ?? {}).slice(0, 200)}`);

    const { data: orgOwner } = await context.supabase.rpc("get_org_owner", { _user_id: context.userId });
    const owner_id = orgOwner ?? context.userId;

    const { data: review, error: insErr } = await context.supabase
      .from("eduardo_contract_reviews")
      .upsert(
        {
          owner_id,
          contract_id: contract.id,
          card_id: data.card_id ?? null,
          status: "sent",
          draft_sent_at: new Date().toISOString(),
          draft_message: message,
          created_by: context.userId,
        },
        { onConflict: "contract_id" },
      )
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return review;
  });

export const eduardoMarkClientApproved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contract_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("eduardo_contract_reviews")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("contract_id", data.contract_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const eduardoHandoffToHuman = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      contract_id: z.string().uuid(),
      note: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: review, error: rErr } = await context.supabase
      .from("eduardo_contract_reviews")
      .update({
        status: "handed_off",
        handed_off_at: new Date().toISOString(),
        handoff_note: data.note ?? null,
      })
      .eq("contract_id", data.contract_id)
      .select("card_id")
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);

    // Desliga a IA no card do Kanban (se houver) para o humano assumir.
    if (review?.card_id) {
      await context.supabase
        .from("kanban_cards")
        .update({ ai_enabled: false })
        .eq("id", review.card_id);
    }
    return { ok: true };
  });

export const getEduardoReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contract_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: review } = await context.supabase
      .from("eduardo_contract_reviews")
      .select("*")
      .eq("contract_id", data.contract_id)
      .maybeSingle();
    const { data: contract } = await context.supabase
      .from("contracts")
      .select("id, title, integrity_score, status, client_id")
      .eq("id", data.contract_id)
      .maybeSingle();
    const clientId = contract?.client_id;
    const { data: client } = clientId
      ? await context.supabase.from("clients").select("full_name, phone").eq("id", clientId).maybeSingle()
      : { data: null };
    return { review, contract, client };
  });


