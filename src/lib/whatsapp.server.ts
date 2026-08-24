export const WAPI_BASE = "https://api.w-api.app/v1";

export async function loadWhatsappCreds(supabase: any, userId: string) {
  const { data: resolvedOwner, error: ownerError } = await supabase.rpc("get_org_owner", {
    _user_id: userId,
  });
  if (ownerError) throw new Error(ownerError.message);
  const ownerId = typeof resolvedOwner === "string" ? resolvedOwner : userId;

  const { data, error } = await supabase
    .from("wapi_config")
    .select("instance_id, api_token")
    .eq("user_id", ownerId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("WhatsApp não configurado");
  if (!data.instance_id || !data.api_token) throw new Error("Credenciais do WhatsApp incompletas");
  return { ...data, owner_id: ownerId } as { instance_id: string; api_token: string; owner_id: string };
}

export function parseWapiConnection(body: any) {
  const candidates = [
    body?.connected,
    body?.phoneConnected,
    body?.loggedIn,
    body?.status,
    body?.state,
    body?.instanceStatus,
    body?.instance?.connected,
    body?.instance?.phoneConnected,
    body?.instance?.loggedIn,
    body?.instance?.status,
    body?.instance?.state,
    body?.data?.connected,
    body?.data?.phoneConnected,
    body?.data?.loggedIn,
    body?.data?.status,
    body?.data?.state,
    body?.data?.instanceStatus,
    body?.data?.instance?.connected,
    body?.data?.instance?.phoneConnected,
    body?.data?.instance?.loggedIn,
    body?.data?.instance?.status,
    body?.data?.instance?.state,
  ];

  const booleanState = candidates.find((value) => typeof value === "boolean");
  const rawState = candidates.find((value) => typeof value === "string");
  const normalizedState = typeof rawState === "string" ? rawState.trim().toLowerCase() : null;
  const connectedStates = new Set(["connected", "open", "online", "ready", "authenticated"]);

  return {
    connected: booleanState === true || (normalizedState !== null && connectedStates.has(normalizedState)),
    state: normalizedState,
    phone:
      body?.phone ?? body?.phoneNumber ?? body?.number ?? body?.formattedNumber ??
      body?.instance?.phone ?? body?.instance?.phoneNumber ??
      body?.data?.phone ?? body?.data?.phoneNumber ?? body?.data?.number ??
      body?.data?.instance?.phone ?? body?.data?.instance?.phoneNumber ?? null,
  };
}

export function getWapiError(body: any, status: number) {
  // W-API às vezes retorna { error: true, message: "...", ... } — nesse caso
  // ignorar o booleano e cair para message/description/reason.
  const rawError = body?.error;
  const candidates = [
    body?.error?.message,
    typeof rawError === "string" ? rawError : undefined,
    body?.message,
    body?.description,
    body?.reason,
    body?.data?.message,
    body?.data?.error,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  try {
    const dump = JSON.stringify(body);
    if (dump && dump !== "{}" && dump !== "true" && dump !== "false") {
      return `HTTP ${status} — ${dump.slice(0, 300)}`;
    }
  } catch {}
  return `HTTP ${status}`;
}