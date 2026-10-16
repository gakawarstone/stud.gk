import { useEffect, useRef, useState } from "react";
import { Code, Download, ExternalLink, FileText, LoaderCircle, X } from "lucide-react";
import { HighlightedCode } from "./HighlightedCode";
import { GitlabMarkdown } from "./GitlabMarkdown";
import { PdfViewer } from "./PdfViewer";
import { demoMarkdown, gitlabApi, type GitlabEntry, type GitlabFile } from "./gitlab-api";

export function GitlabFileViewer({ entry, endpoint, branch, projectUrl, demo, onClose, embedded = false }: {
  entry: GitlabEntry; endpoint: string; branch: string | null; projectUrl: string; demo: boolean; onClose: () => void; embedded?: boolean;
}) {
  const query = new URLSearchParams({ path: entry.path, ...(branch ? { ref: branch } : {}) });
  const contentUrl = `${endpoint}/content?${query}`;
  const downloadUrl = `${contentUrl}&download=1`;
  return /\.pdf$/i.test(entry.name) && !demo && !embedded
    ? <PdfViewer title={entry.name} contentUrl={contentUrl} downloadUrl={downloadUrl} onClose={onClose} />
    : <FileDialog entry={entry} endpoint={endpoint} query={query.toString()} contentUrl={contentUrl} downloadUrl={downloadUrl}
      projectUrl={projectUrl} branch={branch} demo={demo} onClose={onClose} embedded={embedded} />;
}
function FileDialog({ entry, endpoint, query, contentUrl, downloadUrl, projectUrl, branch, demo, onClose, embedded }: {
  entry: GitlabEntry; endpoint: string; query: string; contentUrl: string; downloadUrl: string;
  projectUrl: string; branch: string | null; demo: boolean; onClose: () => void; embedded: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<GitlabFile | null>(null), [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState(false);
  const markdown = /\.(md|markdown|mdown|mkd)$/i.test(entry.name);
  const media = /\.pdf$/i.test(entry.name) ? "pdf" : /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(entry.name) ? "image"
    : /\.(mp4|webm|ogv|mov)$/i.test(entry.name) ? "video" : /\.(mp3|wav|ogg|m4a|flac)$/i.test(entry.name) ? "audio" : null;
  const webUrl = `${projectUrl}/-/blob/${(branch || "HEAD").split("/").map(encodeURIComponent).join("/")}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
  useEffect(() => {
    if (embedded) return;
    const previousFocus = document.activeElement, overflow = document.body.style.overflow;
    const element = dialog.current!;
    document.body.style.overflow = "hidden"; element.showModal();
    return () => {
      element.close(); document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [embedded]);
  useEffect(() => {
    if (media || entry.submodule) return;
    const controller = new AbortController();
    if (demo) {
      setFile({ path: entry.path, webUrl, binary: false, size: 100,
        content: markdown ? demoMarkdown : entry.name.endsWith(".json") ? '{\n  "name": "course-project",\n  "private": true\n}\n'
          : 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n' });
    } else void gitlabApi<GitlabFile>(`${endpoint}/file?${query}`, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setFile(value); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message || "Не удалось открыть файл."); });
    return () => controller.abort();
  }, [endpoint, query, demo, entry.path, entry.name, entry.submodule, media, markdown, webUrl]);
  const content = file?.content;
  const lines = content?.split("\n").length || 0;
  const header = <header className="gitlab-viewer-toolbar">
      <h2 id="gitlab-viewer-title" title={entry.path}>{entry.path}</h2>
      {markdown && <div className="file-view-switch" role="group" aria-label="Вид Markdown">
        <button type="button" aria-label="Просмотр Markdown" title="Просмотр Markdown" aria-pressed={!source} onClick={() => setSource(false)}><FileText size={17} /></button>
        <button type="button" aria-label="Исходный код" title="Исходный код" aria-pressed={source} onClick={() => setSource(true)}><Code size={17} /></button>
      </div>}
      {!demo && !entry.submodule && <a href={downloadUrl} aria-label={`Скачать ${entry.name}`} title="Скачать"><Download size={18} /></a>}
      <a href={webUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть файл в GitLab" title="Открыть в GitLab"><ExternalLink size={17} /></a>
      <button type="button" aria-label="Закрыть просмотр" title="Закрыть" onClick={onClose}><X size={21} /></button>
    </header>;
  const body = <div className="gitlab-viewer-body" tabIndex={embedded ? 0 : undefined} role="region" aria-label="Содержимое файла">
      {error ? <p className="gitlab-viewer-status" role="alert">{error}</p> : entry.submodule ? <p className="gitlab-viewer-status">Это подмодуль. Его можно открыть в GitLab.</p> : media ? (
        media === "pdf" ? <iframe className="gitlab-pdf-frame" src={contentUrl} title={entry.name} />
          : media === "image" ? <img src={contentUrl} alt={entry.name} onError={() => setError("Не удалось загрузить изображение.")} />
          : media === "video" ? <video controls src={contentUrl} aria-label={entry.name} onError={() => setError("Не удалось воспроизвести видео. Файл можно скачать.")} />
            : <audio controls src={contentUrl} aria-label={entry.name} onError={() => setError("Не удалось воспроизвести аудио. Файл можно скачать.")} />
      ) : !file ? <p className="gitlab-viewer-status" role="status"><LoaderCircle size={18} className="spin" />Загружаем файл…</p>
        : file.binary ? <p className="gitlab-viewer-status">Бинарный файл. Скачай его для просмотра на компьютере.</p>
          : markdown && !source ? <GitlabMarkdown content={content || ""} webUrl={file.webUrl} />
            : <div className="gitlab-code-view">
              {lines <= 20000 && <pre className="gitlab-line-numbers" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</pre>}
              <pre className="gitlab-source"><HighlightedCode content={content || ""} language={entry.name} /></pre>
            </div>}
    </div>;
  return <>{embedded ? <section className="gitlab-inline-viewer" aria-label={entry.path} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }}>{body}</section>
    : <dialog ref={dialog} className="gitlab-viewer" aria-labelledby="gitlab-viewer-title" onCancel={onClose}>{header}{body}</dialog>}
  </>;
}
