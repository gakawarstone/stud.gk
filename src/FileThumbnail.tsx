import { FileText, Film, LoaderCircle } from "lucide-solid";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { PdfFileIcon } from "./PdfFileIcon";
const cache = new Map<string, string>();
export function clearThumbnailCache() {
  cache.clear();
}
export function FileThumbnail(props: { url: string; version: string; kind: "pdf" | "image" | "video" }) {
  const key = createMemo(() => `${props.url}:${props.version}`);
  let container: HTMLDivElement | null = null;
  const [visible, setVisible] = createSignal(false);
  const [result, setResult] = createSignal<{
    key: string;
    src: string;
  } | null>(null);
  const [failedKey, setFailedKey] = createSignal<string | null>(null);
  const src = createMemo(() => cache.get(key()) || (result()?.key === key() ? result()!.src : null));
  const failed = createMemo(() => failedKey() === key());
  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    if (container) observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  createEffect(
    on(
      () => [visible(), key(), src(), failed(), props.kind, props.url],
      () => {
        if (!visible() || src() || failed() || props.kind === "image") return;
        const controller = new AbortController();
        const thumbnail =
          props.kind === "video"
            ? import("./video-thumbnails").then(({ renderVideoThumbnail }) =>
                renderVideoThumbnail(props.url, controller.signal),
              )
            : import("./pdf-thumbnails").then(({ renderPdfThumbnail }) =>
                renderPdfThumbnail(props.url, controller.signal),
              );
        void thumbnail
          .then((image) => {
            if (controller.signal.aborted) return;
            // Keep only small rendered images in memory, never the original documents.
            if (cache.size >= 100) cache.delete(cache.keys().next().value!);
            cache.set(key(), image);
            setResult({ key: key(), src: image });
          })
          .catch(() => {
            if (!controller.signal.aborted) setFailedKey(key());
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  return (
    <div class={`file-preview thumbnail-preview ${props.kind}`} ref={(element) => (container = element)}>
      {failed() ? (
        <span class="thumbnail-fallback">
          {props.kind === "pdf" ? (
            <PdfFileIcon size={28} />
          ) : props.kind === "video" ? (
            <Film size={28} stroke-width={1.4} />
          ) : (
            <FileText size={28} stroke-width={1.4} />
          )}
          <span>Preview unavailable</span>
        </span>
      ) : visible() && (props.kind === "image" || src()) ? (
        <Show when={key()} keyed>
          {(_key) => (
            <img
              class="file-thumbnail"
              src={props.kind === "image" ? props.url : src()!}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setFailedKey(key())}
            />
          )}
        </Show>
      ) : (
        <LoaderCircle class="thumbnail-loading spin" size={20} aria-label="Loading preview" />
      )}
    </div>
  );
}
