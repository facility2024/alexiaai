import { useEffect, useRef, useState } from "react";
import { FileText, Download } from "lucide-react";
import { fetchMediaBlob, preloadMedia } from "@/lib/media-cache";

type Variant = "full" | "thumb" | "preview";

function useObjectUrl(mediaId: string, variant: Variant, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    let created: string | null = null;
    setErr(null);
    fetchMediaBlob(mediaId, variant)
      .then((blob) => {
        if (cancel) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch((e) => { if (!cancel) setErr(String(e?.message ?? e)); });
    return () => {
      cancel = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mediaId, variant, enabled]);
  return { url, err };
}

export function Media({
  mediaId,
  kind,
  mime,
  filename,
}: {
  mediaId: string;
  kind?: "image" | "video" | "audio" | "voice" | "document" | null;
  mime?: string | null;
  filename?: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [openFull, setOpenFull] = useState(false);

  // Lazy trigger: only load when scrolled near viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const m = (mime ?? "").toLowerCase();
  const inferred: NonNullable<typeof kind> =
    kind ?? (m.startsWith("image/") ? "image"
      : m.startsWith("video/") ? "video"
      : m.startsWith("audio/") ? "audio"
      : "document");

  // Images/videos: thumb first, swap to full when opened.
  const thumbVariant: Variant = inferred === "image" || inferred === "video" ? "thumb" : "full";
  const { url: thumbUrl, err } = useObjectUrl(mediaId, thumbVariant, visible);
  const { url: fullUrl } = useObjectUrl(mediaId, "full", openFull);

  // Preload full-res as soon as thumb is visible for images.
  useEffect(() => {
    if (visible && inferred === "image") preloadMedia(mediaId, "full");
  }, [visible, inferred, mediaId]);

  const status = err
    ? <p className="text-xs text-destructive">Falha ao carregar mídia</p>
    : !thumbUrl ? <p className="text-xs text-muted-foreground animate-pulse">Carregando…</p> : null;

  return (
    <div ref={ref}>
      {inferred === "image" && (
        status ?? (
          <>
            <img
              src={fullUrl ?? thumbUrl!}
              alt={filename ?? "imagem"}
              loading="lazy"
              className="max-h-64 rounded-lg object-contain cursor-zoom-in"
              onClick={() => setOpenFull(true)}
            />
          </>
        )
      )}
      {inferred === "video" && (
        status ?? (
          <video
            src={fullUrl ?? thumbUrl!}
            controls
            className="max-h-64 w-full rounded-lg"
            onPlay={() => setOpenFull(true)}
          />
        )
      )}
      {(inferred === "audio" || inferred === "voice") && (
        status ?? <audio src={thumbUrl!} controls className="w-64 max-w-full" />
      )}
      {inferred === "document" && (
        status ?? (
          <a
            href={thumbUrl!}
            download={filename ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm underline"
          >
            <FileText className="h-4 w-4" />
            {filename ?? "arquivo"}
            <Download className="h-3 w-3 opacity-60" />
          </a>
        )
      )}
    </div>
  );
}
