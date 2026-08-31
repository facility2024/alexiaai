import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const synthesizeTTS = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ text: z.string().min(1).max(4000), voice: z.string().optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
    if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: data.text,
        voice: data.voice ?? "alloy",
        response_format: "mp3",
        instructions:
          "Fale em português do Brasil, tom amigável, claro e didático, ritmo calmo, como um instrutor apresentando um sistema.",
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`TTS falhou: ${res.status} ${err}`);
    }

    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { audio: base64, mime: "audio/mpeg" };
  });
