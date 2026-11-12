// Licença SaaS (company_licenses): workspaces com licença bloqueada
// (vencida/não iniciada/desativada) não disparam envios automáticos.
// Workspaces SEM licença (painel oficial) nunca entram no conjunto.
// Uso em rotas/crons de envio: receber supabaseAdmin como parâmetro mantém
// este módulo sem segredos (client-safe).
/* eslint-disable @typescript-eslint/no-explicit-any -- types.ts gerado ainda não tem company_licenses; regenerar os tipos torna o cast desnecessário */

export async function filterBlockedLicenseOwners(
  supabaseAdmin: any,
  ownerIds: (string | null)[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  const unique = [...new Set(ownerIds.filter((v): v is string => !!v))];
  if (!unique.length) return blocked;
  const nowTs = Date.now();
  const { data: lics, error } = await supabaseAdmin
    .from("company_licenses")
    .select("owner_user_id, status, starts_at, ends_at")
    .in("owner_user_id", unique);
  if (error) {
    console.warn("[license-check] lookup failed:", error.message);
    return blocked;
  }
  for (const lic of lics ?? []) {
    const isBlocked =
      lic.status !== "active" ||
      new Date(lic.starts_at).getTime() > nowTs ||
      (lic.ends_at != null && new Date(lic.ends_at).getTime() < nowTs);
    if (isBlocked) blocked.add(lic.owner_user_id);
  }
  return blocked;
}
