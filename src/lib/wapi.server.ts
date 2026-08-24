const WAPI = "https://api.w-api.app/v1";

export function isSafeExternalUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const h = url.hostname.toLowerCase();
    if (h === "localhost" || h === "::1") return false;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return false;
    if (/^169\.254\./.test(h) || /^0\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

async function call(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${WAPI}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export const sendPresence = (instanceId: string, token: string, phone: string, presence: "composing" | "recording") =>
  call(`/message/send-presence?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify({ phone, presence }),
  });

export const sendText = (instanceId: string, token: string, phone: string, message: string, delayMessage = 0) =>
  call(`/message/send-text?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify({ phone, message, delayMessage }),
  });

/** Envia áudio via W-API (mensagem de voz). `audio` deve ser URL pública. */
export const sendAudioUrl = (
  instanceId: string,
  token: string,
  phone: string,
  audioUrl: string,
  delayMessage = 0,
) =>
  call(`/message/send-audio?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify({ phone, audio: audioUrl, delayMessage }),
  });

export const setWebhook = (instanceId: string, token: string, webhookUrl: string) =>
  call(`/instance/update-webhook?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify({ webhook: webhookUrl, events: ["messages"] }),
  });

export const markAsRead = (instanceId: string, token: string, phone: string, messageId: string) =>
  call(`/message/read-message?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify({ phone, messageId }),
  });

/**
 * W-API download-media requires: mediaKey, directPath, type, mimetype.
 * messageId is only used as a legacy fallback for older instances.
 */
export const downloadMedia = (
  instanceId: string,
  token: string,
  payload: {
    mediaKey?: string | null;
    directPath?: string | null;
    type?: string | null;
    mimetype?: string | null;
    messageId?: string | null;
    phone?: string | null;
    [k: string]: any;
  },
) => {
  const body: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined && v !== "") body[k] = v;
  }
  return call(`/message/download-media?instanceId=${encodeURIComponent(instanceId)}`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

/** Split text into chunks of <= maxChars by sentence boundaries. */
export function chunkText(text: string, maxChars = 250): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= maxChars) {
      cur = (cur ? cur + " " : "") + s;
    } else {
      if (cur) chunks.push(cur);
      if (s.length <= maxChars) {
        cur = s;
      } else {
        // hard split long sentence
        for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
        cur = "";
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
