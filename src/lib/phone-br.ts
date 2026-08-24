// Normaliza telefones brasileiros para o padrão nacional (sem +55).
// - Remove tudo que não é dígito
// - Remove prefixo 55 quando presente
// - Adiciona o 9º dígito em celulares (DDD + 8 dígitos iniciando em 6/7/8/9)
// - Retorna null se não conseguir validar
export function normalizeBrPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if (!d) return null;

  // remove código do país
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);

  // celular sem 9º dígito: DDD (2) + 8 dígitos começando com 6/7/8/9
  if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) {
    d = d.slice(0, 2) + "9" + d.slice(2);
  }

  // formatos válidos: fixo (10) ou celular (11)
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9]{2}/.test(d)) return null;
  return d;
}

// Valida texto de SMS (max 160, sem emoji, sem caracteres fora do GSM básico)
const EMOJI_RE = /[\p{Extended_Pictographic}]/u;
export function validateSmsText(text: string): { ok: boolean; error?: string } {
  const t = (text ?? "").trim();
  if (!t) return { ok: false, error: "Mensagem vazia" };
  if (t.length > 160) return { ok: false, error: `Máximo 160 caracteres (atual: ${t.length})` };
  if (EMOJI_RE.test(t)) return { ok: false, error: "Emojis não são permitidos em SMS" };
  return { ok: true };
}
