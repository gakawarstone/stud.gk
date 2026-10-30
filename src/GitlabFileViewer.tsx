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
  return /\.pdf$/i.test(entry.name)
    ? <PdfViewer key={contentUrl} title={entry.name} contentUrl={contentUrl} downloadUrl={downloadUrl} onClose={onClose} embedded={embedded} />
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
  const media = /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(entry.name) ? "image"
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
      .catch((error) => { if (!controller.signal.aborted) setError(error.message || "Could not open the file."); });
    return () => controller.abort();
  }, [endpoint, query, demo, entry.path, entry.name, entry.submodule, media, markdown, webUrl]);
  const content = file?.content;
  const lines = content?.split("\n").length || 0;
  const header = <header className="gitlab-viewer-toolbar">
      <h2 id="gitlab-viewer-title" title={entry.path}>{entry.path}</h2>
      {markdown && <div className="file-view-switch" role="group" aria-label="Markdown view">
        <button type="button" aria-label="Preview Markdown" title="Preview Markdown" aria-pressed={!source} onClick={() => setSource(false)}><FileText size={17} /></button>
        <button type="button" aria-label="Source code" title="Source code" aria-pressed={source} onClick={() => setSource(true)}><Code size={17} /></button>
      </div>}
      {!demo && !entry.submodule && <a href={downloadUrl} aria-label={`Download ${entry.name}`} title="Download"><Download size={18} /></a>}
      <a href={webUrl} target="_blank" rel="noopener noreferrer" aria-label="Open file in GitLab" title="Open in GitLab"><ExternalLink size={17} /></a>
      <button type="button" aria-label="Close preview" title="Close" onClick={onClose}><X size={21} /></button>
    </header>;
  const body = <div className="gitlab-viewer-body" tabIndex={embedded ? 0 : undefined} role="region" aria-label="File content">
      {error ? <p className="gitlab-viewer-status" role="alert">{error}</p> : entry.submodule ? <p className="gitlab-viewer-status">This is a submodule. You can open it in GitLab.</p> : media ? (
        media === "image" ? <img src={contentUrl} alt={entry.name} onError={() => setError("Could not load the image.")} />
          : media === "video" ? <video controls src={contentUrl} aria-label={entry.name} onError={() => setError("Could not play the video. You can download the file.")} />
            : <audio controls src={contentUrl} aria-label={entry.name} onError={() => setError("Could not play the audio. You can download the file.")} />
      ) : !file ? <p className="gitlab-viewer-status" role="status"><LoaderCircle size={18} className="spin" />Loading file…</p>
        : file.binary ? <p className="gitlab-viewer-status">Binary file. Download it to view it on your computer.</p>
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
