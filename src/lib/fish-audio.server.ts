// Fish Audio TTS (https://fish.audio) — síntese de voz em MP3.
// Usada quando o agente marca a resposta com a tag [audio] no início.
//
// Docs: POST https://api.fish.audio/v1/tts
// Header: Authorization: Bearer <FISH_AUDIO_API_KEY>
// Body: { text, format, reference_id?, chunk_length?, normalize? }

export type FishTtsResult = { ok: true; mp3: ArrayBuffer } | { ok: false; error: string };

export async function fishAudioSynthesize(
  text: string,
  opts?: { referenceId?: string; model?: string },
): Promise<FishTtsResult> {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) return { ok: false, error: "FISH_AUDIO_API_KEY não configurada" };
  if (!text?.trim()) return { ok: false, error: "texto vazio" };

  // reference_id opcional: id de voz clonada em fish.audio.
  // Pode ser configurado via env FISH_AUDIO_VOICE_ID (voz global) ou passado por parâmetro.
  const referenceId = opts?.referenceId ?? process.env.FISH_AUDIO_VOICE_ID ?? undefined;
  const model = opts?.model ?? process.env.FISH_AUDIO_MODEL ?? "speech-1.6";

  const body: Record<string, unknown> = {
    text: text.slice(0, 4000),
    format: "mp3",
    normalize: true,
    latency: "normal",
  };
  if (referenceId) body.reference_id = referenceId;

  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: `Fish Audio ${res.status}: ${err.slice(0, 300)}` };
  }
  const mp3 = await res.arrayBuffer();
  if (!mp3.byteLength) return { ok: false, error: "áudio vazio" };
  return { ok: true, mp3 };
}
