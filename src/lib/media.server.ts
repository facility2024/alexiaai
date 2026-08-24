// Media helpers: opaque ID + sha256 for bytes + authorization for read.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Opaque 12-char base32 Media ID (~60 bits of entropy). */
export function generateMediaId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) {
    out += BASE32_ALPHABET[b & 0x1f];
    out += BASE32_ALPHABET[(b >> 3) & 0x1f];
  }
  return out.slice(0, 12);
}

/** Hex sha256 of raw bytes. */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type MediaKind = "image" | "video" | "audio" | "voice" | "document";

export function kindFromMime(mime: string | null | undefined): MediaKind {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "audio/ogg" || m === "audio/ogg; codecs=opus") return "voice";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}
