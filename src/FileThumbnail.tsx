import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

const cache = new Map<string, string>();
export function clearThumbnailCache() {
  cache.clear();
}

export function FileThumbnail({
  url,
  version,
  kind,
}: {
  url: string;
  version: string;
  kind: "pdf" | "image";
}) {
  const key = `${url}:${version}`;
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; src: string } | null>(
    null,
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const src = cache.get(key) || (result?.key === key ? result.src : null);
  const failed = failedKey === key;

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || src || failed || kind !== "pdf") return;
    const controller = new AbortController();
    void import("./pdf-thumbnails")
      .then(({ renderPdfThumbnail }) =>
        renderPdfThumbnail(url, controller.signal),
      )
      .then((image) => {
        if (controller.signal.aborted) return;
        // Keep only small rendered images in memory, never the original documents.
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, image);
        setResult({ key, src: image });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedKey(key);
      });
    return () => controller.abort();
  }, [visible, key, src, failed, kind, url]);

  return (
    <div className={`file-preview thumbnail-preview ${kind}`} ref={container}>
      {failed ? (
        <span className="thumbnail-fallback">
          <FileText size={28} strokeWidth={1.4} />
          <span>Превью недоступно</span>
        </span>
      ) : visible && (kind === "image" || src) ? (
        <img
          key={key}
          className="file-thumbnail"
          src={kind === "image" ? url : src!}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailedKey(key)}
        />
      ) : (
        <LoaderCircle
          className="thumbnail-loading spin"
          size={20}
          aria-label="Загружаем превью"
        />
      )}
    </div>
  );
}
