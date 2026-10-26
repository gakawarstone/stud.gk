import {
  Code,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  X,
} from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { GitlabMarkdown } from "./GitlabMarkdown";
import { HighlightedCode } from "./HighlightedCode";
import { PdfViewer } from "./PdfViewer";
import {
  demoMarkdown,
  gitlabApi,
  type GitlabEntry,
  type GitlabFile,
} from "./gitlab-api";
export function GitlabFileViewer(props: {
  entry: GitlabEntry;
  endpoint: string;
  branch: string | null;
  projectUrl: string;
  demo: boolean;
  onClose: () => void;
  embedded?: boolean;
}) {
  const query = createMemo(
    () =>
      new URLSearchParams({
        path: props.entry.path,
        ...(props.branch ? { ref: props.branch } : {}),
      }),
  );
  const contentUrl = createMemo(() => `${props.endpoint}/content?${query()}`);
  const downloadUrl = createMemo(() => `${contentUrl()}&download=1`);
  return (
    <>
      {/\.pdf$/i.test(props.entry.name) &&
      !props.demo &&
      !(props.embedded ?? false) ? (
        <PdfViewer
          title={props.entry.name}
          contentUrl={contentUrl()}
          downloadUrl={downloadUrl()}
          onClose={props.onClose}
        />
      ) : (
        <FileDialog
          entry={props.entry}
          endpoint={props.endpoint}
          query={query().toString()}
          contentUrl={contentUrl()}
          downloadUrl={downloadUrl()}
          projectUrl={props.projectUrl}
          branch={props.branch}
          demo={props.demo}
          onClose={props.onClose}
          embedded={props.embedded ?? false}
        />
      )}
    </>
  );
}
function FileDialog(props: {
  entry: GitlabEntry;
  endpoint: string;
  query: string;
  contentUrl: string;
  downloadUrl: string;
  projectUrl: string;
  branch: string | null;
  demo: boolean;
  onClose: () => void;
  embedded: boolean;
}) {
  let dialog: HTMLDialogElement | null = null;
  const [file, setFile] = createSignal<GitlabFile | null>(null),
    [error, setError] = createSignal<string | null>(null);
  const [source, setSource] = createSignal(false);
  const markdown = createMemo(() =>
    /\.(md|markdown|mdown|mkd)$/i.test(props.entry.name),
  );
  const media = createMemo(() =>
    /\.pdf$/i.test(props.entry.name)
      ? "pdf"
      : /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(props.entry.name)
        ? "image"
        : /\.(mp4|webm|ogv|mov)$/i.test(props.entry.name)
          ? "video"
          : /\.(mp3|wav|ogg|m4a|flac)$/i.test(props.entry.name)
            ? "audio"
            : null,
  );
  const webUrl = createMemo(
    () =>
      `${props.projectUrl}/-/blob/${(props.branch || "HEAD").split("/").map(encodeURIComponent).join("/")}/${props.entry.path.split("/").map(encodeURIComponent).join("/")}`,
  );
  createEffect(
    on(
      () => [props.embedded],
      () => {
        if (props.embedded) return;
        const previousFocus = document.activeElement,
          overflow = document.body.style.overflow;
        const element = dialog!;
        document.body.style.overflow = "hidden";
        element.showModal();
        onCleanup(() => {
          element.close();
          document.body.style.overflow = overflow;
          if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
            previousFocus.focus({ preventScroll: true });
        });
      },
    ),
  );
  createEffect(
    on(
      () => [
        props.endpoint,
        props.query,
        props.demo,
        props.entry.path,
        props.entry.name,
        props.entry.submodule,
        media(),
        markdown(),
        webUrl(),
      ],
      () => {
        if (media() || props.entry.submodule) return;
        const controller = new AbortController();
        if (props.demo) {
          setFile({
            path: props.entry.path,
            webUrl: webUrl(),
            binary: false,
            size: 100,
            content: markdown()
              ? demoMarkdown
              : props.entry.name.endsWith(".json")
                ? '{\n  "name": "course-project",\n  "private": true\n}\n'
                : "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
          });
        } else
          void gitlabApi<GitlabFile>(
            `${props.endpoint}/file?${props.query}`,
            controller.signal,
          )
            .then((value) => {
              if (!controller.signal.aborted) setFile(value);
            })
            .catch((error) => {
              if (!controller.signal.aborted)
                setError(error.message || "Не удалось открыть файл.");
            });
        onCleanup(() => controller.abort());
      },
    ),
  );
  const content = createMemo(() => file()?.content);
  const lines = createMemo(() => content()?.split("\n").length || 0);
  const header = createMemo(() => (
    <header class="gitlab-viewer-toolbar">
      <h2 id="gitlab-viewer-title" title={props.entry.path}>
        {props.entry.path}
      </h2>
      {markdown() && (
        <div class="file-view-switch" role="group" aria-label="Вид Markdown">
          <button
            type="button"
            aria-label="Просмотр Markdown"
            title="Просмотр Markdown"
            aria-pressed={!source()}
            onClick={() => setSource(false)}
          >
            <FileText size={17} />
          </button>
          <button
            type="button"
            aria-label="Исходный код"
            title="Исходный код"
            aria-pressed={source()}
            onClick={() => setSource(true)}
          >
            <Code size={17} />
          </button>
        </div>
      )}
      {!props.demo && !props.entry.submodule && (
        <a
          href={props.downloadUrl}
          aria-label={`Скачать ${props.entry.name}`}
          title="Скачать"
        >
          <Download size={18} />
        </a>
      )}
      <a
        href={webUrl()}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Открыть файл в GitLab"
        title="Открыть в GitLab"
      >
        <ExternalLink size={17} />
      </a>
      <button
        type="button"
        aria-label="Закрыть просмотр"
        title="Закрыть"
        onClick={props.onClose}
      >
        <X size={21} />
      </button>
    </header>
  ));
  const body = createMemo(() => (
    <div
      class="gitlab-viewer-body"
      tabindex={props.embedded ? 0 : undefined}
      role="region"
      aria-label="Содержимое файла"
    >
      {error() ? (
        <p class="gitlab-viewer-status" role="alert">
          {error()}
        </p>
      ) : props.entry.submodule ? (
        <p class="gitlab-viewer-status">
          Это подмодуль. Его можно открыть в GitLab.
        </p>
      ) : media() ? (
        media() === "pdf" ? (
          <iframe
            class="gitlab-pdf-frame"
            src={props.contentUrl}
            title={props.entry.name}
          />
        ) : media() === "image" ? (
          <img
            src={props.contentUrl}
            alt={props.entry.name}
            onError={() => setError("Не удалось загрузить изображение.")}
          />
        ) : media() === "video" ? (
          <video
            controls
            src={props.contentUrl}
            aria-label={props.entry.name}
            onError={() =>
              setError("Не удалось воспроизвести видео. Файл можно скачать.")
            }
          />
        ) : (
          <audio
            controls
            src={props.contentUrl}
            aria-label={props.entry.name}
            onError={() =>
              setError("Не удалось воспроизвести аудио. Файл можно скачать.")
            }
          />
        )
      ) : !file() ? (
        <p class="gitlab-viewer-status" role="status">
          <LoaderCircle size={18} class="spin" />
          Загружаем файл…
        </p>
      ) : file()!.binary ? (
        <p class="gitlab-viewer-status">
          Бинарный файл. Скачай его для просмотра на компьютере.
        </p>
      ) : markdown() && !source() ? (
        <GitlabMarkdown content={content() || ""} webUrl={file()!.webUrl} />
      ) : (
        <div class="gitlab-code-view">
          {lines() <= 20000 && (
            <pre class="gitlab-line-numbers" aria-hidden="true">
              {Array.from({ length: lines() }, (_, i) => i + 1).join("\n")}
            </pre>
          )}
          <pre class="gitlab-source">
            <HighlightedCode
              content={content() || ""}
              language={props.entry.name}
            />
          </pre>
        </div>
      )}
    </div>
  ));
  return (
    <>
      {props.embedded ? (
        <section
          class="gitlab-inline-viewer"
          aria-label={props.entry.path}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
        >
          {body()}
        </section>
      ) : (
        <dialog
          ref={(element) => (dialog = element)}
          class="gitlab-viewer"
          aria-labelledby="gitlab-viewer-title"
          onCancel={props.onClose}
        >
          {header()}
          {body()}
        </dialog>
      )}
    </>
  );
}
