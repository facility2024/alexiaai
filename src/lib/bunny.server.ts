// Bunny Storage + CDN client (server-only).
// Docs: https://docs.bunny.net/reference/storage-api and Pull Zone Token Authentication.

function stripProto(h: string): string {
  return h.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v.trim();
}

function storageHost(): string {
  const configured = process.env.BUNNY_STORAGE_HOSTNAME;
  return configured
    ? `https://${stripProto(configured)}`
    : "https://br.storage.bunnycdn.com";
}

function storageUrl(path: string): string {
  const zone = env("BUNNY_STORAGE_ZONE");
  const cleanPath = path.replace(/^\/+/, "");
  return `${storageHost()}/${encodeURIComponent(zone)}/${cleanPath}`;
}

/** PUT bytes into Bunny Storage under the given path (no leading slash). */
export async function bunnyPut(path: string, bytes: Uint8Array | ArrayBuffer, contentType: string | null): Promise<void> {
  const pass = env("BUNNY_STORAGE_PASSWORD");
  const url = storageUrl(path);
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: pass,
      "Content-Type": contentType ?? "application/octet-stream",
    },
    body: bytes as BodyInit,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`bunny put ${r.status}: ${txt.slice(0, 200)}`);
  }
}

/** DELETE an object from Bunny Storage. */
export async function bunnyDelete(path: string): Promise<void> {
  const pass = env("BUNNY_STORAGE_PASSWORD");
  const url = storageUrl(path);
  const r = await fetch(url, { method: "DELETE", headers: { AccessKey: pass } });
  if (!r.ok && r.status !== 404) {
    const txt = await r.text().catch(() => "");
    throw new Error(`bunny delete ${r.status}: ${txt.slice(0, 200)}`);
  }
}

/** Read an object through Bunny Storage's authenticated API. */
export async function bunnyGet(path: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(storageUrl(path), {
    method: "GET",
    headers: { AccessKey: env("BUNNY_STORAGE_PASSWORD") },
    signal: init?.signal,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Bunny Token Authentication: token = base64url( sha256_bytes( key + signed_url_path + expires ) )
// Reference: https://docs.bunny.net/docs/cdn-token-authentication
async function bunnyTokenB64(pathWithQuery: string, expires: number): Promise<string> {
  const key = env("BUNNY_TOKEN_AUTH_KEY");
  const raw = key + pathWithQuery + expires;
  const buf = new TextEncoder().encode(raw);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  // base64url without padding
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a signed CDN URL with optional Bunny Optimizer query params. TTL in seconds. */
export async function bunnySignedUrl(
  storagePath: string,
  opts: { ttlSeconds?: number; query?: Record<string, string | number | undefined> } = {},
): Promise<string> {
  const host = stripProto(env("BUNNY_CDN_HOSTNAME"));
  const ttl = opts.ttlSeconds ?? 600;
  const expires = Math.floor(Date.now() / 1000) + ttl;

  const path = "/" + storagePath.replace(/^\/+/, "");
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  const pathWithQuery = qs ? `${path}?${qs}` : path;

  const token = await bunnyTokenB64(pathWithQuery, expires);
  const sep = qs ? "&" : "?";
  return `https://${host}${pathWithQuery}${sep}token=${token}&expires=${expires}`;
}

export { sha256Hex };
