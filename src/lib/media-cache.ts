// Client-side media cache using the Cache API (persists across reloads).
// Falls back to in-memory Map when Cache API is unavailable (SSR / older browsers).

import { supabase } from "@/integrations/supabase/client";

const CACHE_NAME = "media-v1";
const memoryCache = new Map<string, Blob>();
const inflight = new Map<string, Promise<Blob>>();

function keyOf(mediaId: string, variant: string) {
  return `/__media/${mediaId}?variant=${variant}`;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try { return await caches.open(CACHE_NAME); } catch { return null; }
}

async function readCache(mediaId: string, variant: string): Promise<Blob | null> {
  const key = keyOf(mediaId, variant);
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  const c = await openCache();
  if (!c) return null;
  const r = await c.match(key);
  if (!r) return null;
  const blob = await r.blob();
  memoryCache.set(key, blob);
  return blob;
}

async function writeCache(mediaId: string, variant: string, blob: Blob) {
  const key = keyOf(mediaId, variant);
  memoryCache.set(key, blob);
  const c = await openCache();
  if (!c) return;
  try {
    await c.put(key, new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }));
  } catch { /* quota etc — best-effort */ }
}

/** Fetch a media asset as a Blob (cached). Deduplicates concurrent requests. */
export async function fetchMediaBlob(mediaId: string, variant: "full" | "thumb" | "preview" = "full"): Promise<Blob> {
  const key = keyOf(mediaId, variant);
  const cached = await readCache(mediaId, variant);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("no session");
    const r = await fetch(`/api/media/${encodeURIComponent(mediaId)}?variant=${variant}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`media ${r.status}`);
    const blob = await r.blob();
    await writeCache(mediaId, variant, blob);
    return blob;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/** Fire-and-forget preload; ignores errors. */
export function preloadMedia(mediaId: string, variant: "full" | "thumb" | "preview" = "thumb") {
  fetchMediaBlob(mediaId, variant).catch(() => {});
}
