import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Download, FileText, Film, Folder, Headphones, Image, LoaderCircle } from "lucide-react";
import { nextcloudUrl } from "./nextcloud-url";
import { FileThumbnail } from "./FileThumbnail";
import { NextcloudSettings } from "./NextcloudSettings";
import { NextcloudViewer, nextcloudFileKind, type NextcloudEntry } from "./NextcloudViewer";

type Listing = { title: string; path: string; backend: string; entries: NextcloudEntry[] };

function sizeLabel(size: number) {
  return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB`
    : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB`
    : size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} B`;
}

export function NextcloudSection({ storageKey, toolbarTarget }: { storageKey: string; toolbarTarget: HTMLElement | null }) {
  const [savedUrl, setSavedUrl] = useState(() => {
    try { return nextcloudUrl(localStorage.getItem(storageKey) || "") || ""; } catch { return ""; }
  });
  const [input, setInput] = useState(savedUrl);
  const [editing, setEditing] = useState(!savedUrl);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState("");
  const [revision, setRevision] = useState(0);
  const [viewed, setViewed] = useState<NextcloudEntry | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) urlInput.current?.focus(); }, [editing]);

  useEffect(() => {
    if (!savedUrl) return;
    const controller = new AbortController();
    setLoading(true);
    setListing(null);
    setLoadError(null);
    void fetch("/api/nextcloud/list", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: savedUrl, path }), signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retrieve Nextcloud files.");
      if (!controller.signal.aborted) setListing(data);
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [savedUrl, path, revision]);

  function fileUrl(file: NextcloudEntry, mode: "preview" | "download") {
    return `/api/nextcloud/file/${mode}?${new URLSearchParams({ share: savedUrl, path: file.path, name: file.name, backend: listing?.backend || "dav" })}`;
  }

  return <section className="nextcloud-section" aria-label="Nextcloud">
    {savedUrl && toolbarTarget && createPortal(<NextcloudSettings url={savedUrl} loading={loading}
      onRefresh={() => setRevision((value) => value + 1)} onEdit={() => { setEditing(true); urlInput.current?.focus(); }} />, toolbarTarget)}
    {editing && <form className="nextcloud-form" noValidate onSubmit={(event) => {
      event.preventDefault();
      const url = nextcloudUrl(input);
      if (!url) { setError("Enter a complete public Nextcloud URL starting with https:// or http://."); return; }
      try {
        localStorage.setItem(storageKey, url);
        setSavedUrl(url);
        setInput(url);
        setError(null);
        setPath("");
        setViewed(null);
        setEditing(false);
        setRevision((value) => value + 1);
      } catch { setError("Could not save the link. Check that local storage is enabled."); }
    }}>
      <label htmlFor="nextcloud-url">Nextcloud shared folder or file URL</label>
      <input ref={urlInput} id="nextcloud-url" name="nextcloud-url" type="url" inputMode="url"
        autoComplete="off" spellCheck={false} placeholder="https://nextcloud.example.org/s/…"
        value={input} aria-invalid={Boolean(error)}
        aria-describedby={`nextcloud-help${error ? " nextcloud-error" : ""}`}
        onChange={(event) => { setInput(event.target.value); setError(null); }} />
      <p id="nextcloud-help" className="course-section-notice">Paste a public link without a password. Files will appear here.</p>
      {error && <p id="nextcloud-error" className="nextcloud-error" role="alert">{error}</p>}
      <div className="nextcloud-actions">
        <button className="nextcloud-save" type="submit">Save link</button>
        {savedUrl && <button type="button" onClick={() => { setEditing(false); setInput(savedUrl); setError(null); }}>Cancel</button>}
      </div>
    </form>}
    {savedUrl && <>
      {path && <nav className="nextcloud-breadcrumbs" aria-label="Nextcloud folder">
        <button type="button" onClick={() => setPath("")}>All files</button>
        {path.split("/").filter(Boolean).map((part, index, parts) => <span key={index}>
          <ChevronRight size={14} aria-hidden="true" />
          <button type="button" disabled={index === parts.length - 1} onClick={() => setPath(parts.slice(0, index + 1).join("/"))}>{part}</button>
        </span>)}
      </nav>}
      {loading && <p className="nextcloud-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading files…</p>}
      {loadError && <div className="nextcloud-load-error" role="alert"><p>{loadError}</p><button className="nextcloud-save" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
      {listing && <div className="file-grid nextcloud-files" aria-label="Nextcloud files">
        {listing.entries.map((file) => {
          const kind = nextcloudFileKind(file);
          const Icon = file.directory ? Folder : kind === "video" ? Film : kind === "audio" ? Headphones : kind === "image" ? Image : FileText;
          return <article className="file-card nextcloud-file" key={file.path}>
            <button type="button" className="file-card-link" aria-label={`${file.directory ? "Open folder" : "Open"} ${file.name}`}
              aria-haspopup={file.directory ? undefined : "dialog"} onClick={() => file.directory ? setPath(file.path) : setViewed(file)}>
              {!file.directory && (kind === "pdf" || kind === "image" || kind === "video") ? <FileThumbnail url={fileUrl(file, "preview")} version={file.etag} kind={kind} />
                : <div className={`file-preview ${file.directory ? "folder" : kind}`}><Icon size={42} strokeWidth={1.4} />
                  <span className="file-type">{file.directory ? "Folder" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : file.name.split(".").pop()?.toUpperCase()}</span>
                </div>}
              <div className="file-info"><h2 title={file.name}>{file.name}</h2>
                <div className="file-meta">{!file.directory && <span>{sizeLabel(file.size)}</span>}
                  {file.modified && <time dateTime={file.modified}>{new Date(file.modified).toLocaleDateString("en-GB")}</time>}
                </div>
              </div>
            </button>
            {!file.directory && <a className="nextcloud-download" href={fileUrl(file, "download")} aria-label={`Download ${file.name}`}><Download size={17} /></a>}
          </article>;
        })}
        {!listing.entries.length && <p className="course-section-notice">No files in this folder yet.</p>}
      </div>}
    </>}
    {viewed && <NextcloudViewer key={viewed.path} file={viewed} contentUrl={fileUrl(viewed, "preview")} downloadUrl={fileUrl(viewed, "download")} onClose={() => setViewed(null)} />}
  </section>;
}
