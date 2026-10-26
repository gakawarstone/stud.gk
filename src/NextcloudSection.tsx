import {
  ChevronRight,
  Download,
  FileText,
  Film,
  Folder,
  Headphones,
  Image,
  LoaderCircle,
} from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { FileThumbnail } from "./FileThumbnail";
import { nextcloudUrl } from "./nextcloud-url";
import { NextcloudSettings } from "./NextcloudSettings";
import {
  nextcloudFileKind,
  NextcloudViewer,
  type NextcloudEntry,
} from "./NextcloudViewer";
type Listing = {
  title: string;
  path: string;
  backend: string;
  entries: NextcloudEntry[];
};
function sizeLabel(size: number) {
  return size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(1)} ГБ`
    : size >= 1024 ** 2
      ? `${(size / 1024 ** 2).toFixed(1)} МБ`
      : size >= 1024
        ? `${Math.round(size / 1024)} КБ`
        : `${size} Б`;
}
export function NextcloudSection(props: {
  storageKey: string;
  toolbarTarget: HTMLElement | null;
}) {
  const [savedUrl, setSavedUrl] = createSignal(
    (() => {
      try {
        return nextcloudUrl(localStorage.getItem(props.storageKey) || "") || "";
      } catch {
        return "";
      }
    })(),
  );
  const [input, setInput] = createSignal(savedUrl());
  const [editing, setEditing] = createSignal(!savedUrl());
  const [error, setError] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [listing, setListing] = createSignal<Listing | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [path, setPath] = createSignal("");
  const [revision, setRevision] = createSignal(0);
  const [viewed, setViewed] = createSignal<NextcloudEntry | null>(null);
  let urlInput: HTMLInputElement | null = null;
  createEffect(
    on(
      () => [editing()],
      () => {
        if (editing()) urlInput?.focus();
      },
    ),
  );
  createEffect(
    on(
      () => [savedUrl(), path(), revision()],
      () => {
        if (!savedUrl()) return;
        const controller = new AbortController();
        setLoading(true);
        setListing(null);
        setLoadError(null);
        void fetch("/api/nextcloud/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: savedUrl(), path: path() }),
          signal: controller.signal,
        })
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok)
              throw new Error(
                data.error || "Не удалось получить файлы Nextcloud.",
              );
            if (!controller.signal.aborted) setListing(data);
          })
          .catch((error) => {
            if (!controller.signal.aborted) setLoadError(error.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  function fileUrl(file: NextcloudEntry, mode: "preview" | "download") {
    return `/api/nextcloud/file/${mode}?${new URLSearchParams({ share: savedUrl(), path: file.path, name: file.name, backend: listing()?.backend || "dav" })}`;
  }
  return (
    <section class="nextcloud-section" aria-label="Nextcloud">
      {savedUrl() && props.toolbarTarget && (
        <Portal mount={props.toolbarTarget}>
          {
            <NextcloudSettings
              url={savedUrl()}
              loading={loading()}
              onRefresh={() => setRevision((value) => value + 1)}
              onEdit={() => {
                setEditing(true);
                urlInput?.focus();
              }}
            />
          }
        </Portal>
      )}
      {editing() && (
        <form
          class="nextcloud-form"
          novalidate
          onSubmit={(event) => {
            event.preventDefault();
            const url = nextcloudUrl(input());
            if (!url) {
              setError(
                "Введи полную публичную ссылку Nextcloud с https:// или http://.",
              );
              return;
            }
            try {
              localStorage.setItem(props.storageKey, url);
              setSavedUrl(url);
              setInput(url);
              setError(null);
              setPath("");
              setViewed(null);
              setEditing(false);
              setRevision((value) => value + 1);
            } catch {
              setError(
                "Не удалось сохранить ссылку. Проверь, разрешено ли локальное хранилище.",
              );
            }
          }}
        >
          <label for="nextcloud-url">
            Ссылка на общую папку или файл Nextcloud
          </label>
          <input
            ref={(element) => (urlInput = element)}
            id="nextcloud-url"
            name="nextcloud-url"
            type="url"
            inputmode="url"
            autocomplete="off"
            spellcheck={false}
            placeholder="https://nextcloud.example.org/s/…"
            value={input()}
            aria-invalid={Boolean(error())}
            aria-describedby={`nextcloud-help${error() ? " nextcloud-error" : ""}`}
            onInput={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
          />
          <p id="nextcloud-help" class="course-section-notice">
            Вставь публичную ссылку без пароля. Файлы появятся здесь.
          </p>
          {error() && (
            <p id="nextcloud-error" class="nextcloud-error" role="alert">
              {error()}
            </p>
          )}
          <div class="nextcloud-actions">
            <button class="nextcloud-save" type="submit">
              Сохранить ссылку
            </button>
            {savedUrl() && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setInput(savedUrl());
                  setError(null);
                }}
              >
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
      {savedUrl() && (
        <>
          {path() && (
            <nav class="nextcloud-breadcrumbs" aria-label="Папка Nextcloud">
              <button type="button" onClick={() => setPath("")}>
                Все файлы
              </button>
              {path()
                .split("/")
                .filter(Boolean)
                .map((part, index, parts) => (
                  <span>
                    <ChevronRight size={14} aria-hidden="true" />
                    <button
                      type="button"
                      disabled={index === parts.length - 1}
                      onClick={() =>
                        setPath(parts.slice(0, index + 1).join("/"))
                      }
                    >
                      {part}
                    </button>
                  </span>
                ))}
            </nav>
          )}
          {loading() && (
            <p class="nextcloud-loading" role="status">
              <LoaderCircle size={18} class="spin" /> Загружаем файлы…
            </p>
          )}
          {loadError() && (
            <div class="nextcloud-load-error" role="alert">
              <p>{loadError()}</p>
              <button
                class="nextcloud-save"
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Повторить
              </button>
            </div>
          )}
          {listing() && (
            <div class="file-grid nextcloud-files" aria-label="Файлы Nextcloud">
              {
                <For each={listing()!.entries}>
                  {(file) => {
                    const kind = nextcloudFileKind(file);
                    const Icon = file.directory
                      ? Folder
                      : kind === "video"
                        ? Film
                        : kind === "audio"
                          ? Headphones
                          : kind === "image"
                            ? Image
                            : FileText;
                    return (
                      <article class="file-card nextcloud-file">
                        <button
                          type="button"
                          class="file-card-link"
                          aria-label={`${file.directory ? "Открыть папку" : "Открыть"} ${file.name}`}
                          aria-haspopup={file.directory ? undefined : "dialog"}
                          onClick={() =>
                            file.directory
                              ? setPath(file.path)
                              : setViewed(file)
                          }
                        >
                          {!file.directory &&
                          (kind === "pdf" ||
                            kind === "image" ||
                            kind === "video") ? (
                            <FileThumbnail
                              url={fileUrl(file, "preview")}
                              version={file.etag}
                              kind={kind}
                            />
                          ) : (
                            <div
                              class={`file-preview ${file.directory ? "folder" : kind}`}
                            >
                              <Icon size={42} stroke-width={1.4} />
                              <span class="file-type">
                                {file.directory
                                  ? "Папка"
                                  : kind === "video"
                                    ? "Видео"
                                    : kind === "audio"
                                      ? "Аудио"
                                      : file.name
                                          .split(".")
                                          .pop()
                                          ?.toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div class="file-info">
                            <h2 title={file.name}>{file.name}</h2>
                            <div class="file-meta">
                              {!file.directory && (
                                <span>{sizeLabel(file.size)}</span>
                              )}
                              {file.modified && (
                                <time datetime={file.modified}>
                                  {new Date(file.modified).toLocaleDateString(
                                    "ru-RU",
                                  )}
                                </time>
                              )}
                            </div>
                          </div>
                        </button>
                        {!file.directory && (
                          <a
                            class="nextcloud-download"
                            href={fileUrl(file, "download")}
                            aria-label={`Скачать ${file.name}`}
                          >
                            <Download size={17} />
                          </a>
                        )}
                      </article>
                    );
                  }}
                </For>
              }
              {!listing()!.entries.length && (
                <p class="course-section-notice">
                  В этой папке пока нет файлов.
                </p>
              )}
            </div>
          )}
        </>
      )}
      <Show when={viewed()} keyed>
        {(file) => (
          <NextcloudViewer
            file={file}
            contentUrl={fileUrl(file, "preview")}
            downloadUrl={fileUrl(file, "download")}
            onClose={() => setViewed(null)}
          />
        )}
      </Show>
    </section>
  );
}
