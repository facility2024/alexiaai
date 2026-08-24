import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Download } from "lucide-react";
import { getMediaDownloadUrl } from "@/lib/media.functions";

export function MediaBubble({
  path,
  mime,
  filename,
}: {
  path: string;
  mime: string | null;
  filename: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const fn = useServerFn(getMediaDownloadUrl);

  useEffect(() => {
    let cancel = false;
    fn({ data: { path } })
      .then((r) => { if (!cancel) setUrl(r.url); })
      .catch(() => { if (!cancel) setErr(true); });
    return () => { cancel = true; };
  }, [path]);

  if (err) return <p className="text-xs text-destructive">Falha ao carregar mídia</p>;
  if (!url) return <p className="text-xs text-muted-foreground animate-pulse">Carregando mídia…</p>;

  const m = mime ?? "";
  if (m.startsWith("image/")) {
    return <img src={url} alt={filename ?? "imagem"} className="max-h-64 rounded-lg object-contain" loading="lazy" />;
  }
  if (m.startsWith("audio/")) {
    return <audio src={url} controls className="w-64 max-w-full" />;
  }
  if (m.startsWith("video/")) {
    return <video src={url} controls className="max-h-64 w-full rounded-lg" />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline">
      <FileText className="h-4 w-4" />
      {filename ?? "arquivo"}
      <Download className="h-3 w-3 opacity-60" />
    </a>
  );
}
