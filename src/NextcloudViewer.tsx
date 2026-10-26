import { Download, X } from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { PdfViewer } from "./PdfViewer";
export type NextcloudEntry = {
  path: string;
  name: string;
  directory: boolean;
  mime: string;
  size: number;
  modified: string | null;
  etag: string;
};
export function nextcloudFileKind(file: NextcloudEntry) {
  if (file.mime === "application/pdf" || /\.pdf$/i.test(file.name))
    return "pdf";
  if (
    file.mime.startsWith("video/") ||
    /\.(mp4|webm|ogv|mov)$/i.test(file.name)
  )
    return "video";
  if (
    file.mime.startsWith("audio/") ||
    /\.(mp3|ogg|wav|m4a|flac)$/i.test(file.name)
  )
    return "audio";
  if (
    /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.mime) ||
    /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name)
  )
    return "image";
  if (
    file.mime.startsWith("text/") ||
    /\.(txt|md|csv|json|html?|svg|js|ts|css|py|java|kt|xml|ya?ml)$/i.test(
      file.name,
    )
  )
    return "text";
  return "other";
}
export function NextcloudViewer(props: {
  file: NextcloudEntry;
  contentUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const kind = createMemo(() => nextcloudFileKind(props.file));
  return (
    <>
      {kind() === "pdf" ? (
        <PdfViewer
          title={props.file.name}
          contentUrl={props.contentUrl}
          downloadUrl={props.downloadUrl}
          onClose={props.onClose}
        />
      ) : (
        <MediaViewer
          file={props.file}
          kind={kind()}
          contentUrl={props.contentUrl}
          downloadUrl={props.downloadUrl}
          onClose={props.onClose}
        />
      )}
    </>
  );
}
function MediaViewer(props: {
  file: NextcloudEntry;
  kind: string;
  contentUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  let dialog: HTMLDialogElement | null = null;
  const [text, setText] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  onMount(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog!.showModal();
    onCleanup(() => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    });
  });
  createEffect(
    on(
      () => [props.kind, props.contentUrl],
      () => {
        if (props.kind !== "text") return;
        const controller = new AbortController();
        void (async () => {
          const response = await fetch(props.contentUrl, {
            signal: controller.signal,
          });
          if (!response.ok || !response.body)
            throw new Error("Не удалось загрузить файл.");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let result = "",
            length = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 2 * 1024 * 1024) {
              await reader.cancel();
              throw new Error(
                "Файл слишком большой для просмотра текста. Его можно скачать.",
              );
            }
            result += decoder.decode(value, { stream: true });
          }
          if (!controller.signal.aborted) setText(result + decoder.decode());
        })().catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
        onCleanup(() => controller.abort());
      },
    ),
  );
  const mediaError = () =>
    setError(
      "Не удалось воспроизвести файл. Попробуй скачать и открыть его на компьютере.",
    );
  return (
    <dialog
      ref={(element) => (dialog = element)}
      class="nextcloud-viewer"
      aria-labelledby="nextcloud-viewer-title"
      onCancel={props.onClose}
    >
      <header class="nextcloud-viewer-toolbar">
        <h2 id="nextcloud-viewer-title">{props.file.name}</h2>
        <a href={props.downloadUrl} aria-label={`Скачать ${props.file.name}`}>
          <Download size={19} />
        </a>
        <button
          type="button"
          aria-label="Закрыть просмотр"
          onClick={props.onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div class="nextcloud-viewer-body">
        {error() ? (
          <p role="alert">{error()}</p>
        ) : (
          <>
            {props.kind === "video" && (
              <video
                src={props.contentUrl}
                controls
                preload="metadata"
                onError={mediaError}
                aria-label={props.file.name}
              />
            )}
            {props.kind === "audio" && (
              <audio
                src={props.contentUrl}
                controls
                preload="metadata"
                onError={mediaError}
                aria-label={props.file.name}
              />
            )}
            {props.kind === "image" && (
              <img
                src={props.contentUrl}
                alt={props.file.name}
                onError={() => setError("Не удалось загрузить изображение.")}
              />
            )}
            {props.kind === "text" &&
              (text() === null ? (
                <p role="status">Загружаем файл…</p>
              ) : (
                <pre>{text()}</pre>
              ))}
            {props.kind === "other" && (
              <p>
                Этот формат можно{" "}
                <a href={props.downloadUrl}>скачать и открыть на компьютере</a>.
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
