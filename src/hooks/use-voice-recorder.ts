import { useCallback, useEffect, useRef, useState } from "react";
import { Mp3Encoder } from "@breezystack/lamejs";

// Sample rates válidas para MPEG-1/2/2.5 (lamejs).
const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // tenta o próximo candidato
    }
  }
  return undefined;
}

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function audioBlobToMp3(blob: Blob): Promise<File> {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf);
  } catch {
    throw new Error("Não foi possível processar a gravação deste navegador.");
  } finally {
    void ctx.close();
  }
  if (!decoded.duration || decoded.duration <= 0) {
    throw new Error("Gravação vazia — tente novamente.");
  }

  // decodeAudioData devolve na sampleRate do contexto; se não for suportada
  // pelo lamejs, reamostra para 44100 via OfflineAudioContext.
  let audio = decoded;
  if (!MP3_SAMPLE_RATES.includes(audio.sampleRate)) {
    const rate = 44100;
    const frames = Math.max(1, Math.ceil(audio.duration * rate));
    const off = new OfflineAudioContext(audio.numberOfChannels, frames, rate);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    audio = await off.startRendering();
  }

  const channels = Math.min(audio.numberOfChannels, 2);
  const encoder = new Mp3Encoder(channels, audio.sampleRate, channels > 1 ? 128 : 64);
  const left = floatToInt16(audio.getChannelData(0));
  const right = channels > 1 ? floatToInt16(audio.getChannelData(1)) : null;
  const block = 1152;
  const parts: BlobPart[] = [];
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const chunk = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + block))
      : encoder.encodeBuffer(l);
    if (chunk.length) parts.push(chunk as unknown as BlobPart);
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail as unknown as BlobPart);

  const mp3 = new Blob(parts, { type: "audio/mpeg" });
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return new File([mp3], `nota-voz-${stamp}.mp3`, { type: "audio/mpeg" });
}

export type VoiceRecorderState = {
  recording: boolean;
  busy: boolean;
  seconds: number;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
};

export function useVoiceRecorder(onRecorded: (file: File) => void): VoiceRecorderState {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseMedia = useCallback(() => {
    stopTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [stopTimer]);

  const start = useCallback(async () => {
    if (!supported) throw new Error("Gravação de áudio não é suportada neste navegador.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      streamRef.current = stream;
      recorderRef.current = rec;
      rec.start(250);
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
  }, [supported]);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        if (rec.state === "inactive") {
          resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
          return;
        }
        rec.onstop = () =>
          resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
        rec.onerror = () => reject(new Error("Falha ao finalizar a gravação."));
        try {
          rec.stop();
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Falha ao finalizar a gravação."));
        }
      });
      releaseMedia();
      setRecording(false);
      setSeconds(0);
      if (blob.size === 0) throw new Error("Gravação vazia — tente novamente.");
      const file = await audioBlobToMp3(blob);
      onRecordedRef.current(file);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [releaseMedia]);

  const cancel = useCallback(() => {
    if (busyRef.current) return;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        // já estava parado
      }
    }
    releaseMedia();
    setRecording(false);
    setSeconds(0);
  }, [releaseMedia]);

  useEffect(() => {
    return () => {
      if (busyRef.current) return;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          // ignora ao desmontar
        }
      }
      releaseMedia();
    };
  }, [releaseMedia]);

  return { recording, busy, seconds, supported, start, stop, cancel };
}
