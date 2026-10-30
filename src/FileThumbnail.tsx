import { useEffect, useRef, useState } from "react";
import { FileText, Film, LoaderCircle } from "lucide-react";
import { PdfFileIcon } from "./PdfFileIcon";

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
  kind: "pdf" | "image" | "video";
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
    if (!visible || src || failed || kind === "image") return;
    const controller = new AbortController();
    const thumbnail = kind === "video"
      ? import("./video-thumbnails").then(({ renderVideoThumbnail }) => renderVideoThumbnail(url, controller.signal))
      : import("./pdf-thumbnails").then(({ renderPdfThumbnail }) => renderPdfThumbnail(url, controller.signal));
    void thumbnail
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
          {kind === "pdf" ? <PdfFileIcon size={28} /> : kind === "video" ? <Film size={28} strokeWidth={1.4} /> : <FileText size={28} strokeWidth={1.4} />}
          <span>Preview unavailable</span>
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
          aria-label="Loading preview"
        />
      )}
    </div>
  );
}
