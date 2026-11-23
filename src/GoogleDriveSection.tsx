import { ChevronRight, Download, FileText, Film, Folder, Headphones, Image, LoaderCircle } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { FileThumbnail } from "./FileThumbnail";
import { NextcloudSettings } from "./NextcloudSettings";
import { nextcloudFileKind, NextcloudViewer, type NextcloudEntry } from "./NextcloudViewer";

type Entry = NextcloudEntry & { id: string; resourceKey: string };
type FolderPath = { name: string; url: string };
function folderUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.host !== "drive.google.com" || url.username || url.password || !/^\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,200}\/?$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function GoogleDriveSection(props: { storageKey: string; toolbarTarget: HTMLElement | null }) {
  const [saved, setSaved] = createSignal((() => { try { return folderUrl(localStorage.getItem(props.storageKey) || "") || ""; } catch { return ""; } })());
  const [input, setInput] = createSignal(saved());
  const [editing, setEditing] = createSignal(!saved());
  const [folders, setFolders] = createSignal<FolderPath[]>([]);
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
  const [error, setError] = createSignal("");
  const [loadError, setLoadError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [viewed, setViewed] = createSignal<Entry | null>(null);
  let urlInput: HTMLInputElement | undefined;
  createEffect(on(() => editing(), editing => { if (editing) urlInput?.focus(); }));
  createEffect(on(() => [saved(), folders(), revision()] as const, () => {
    const url = folders().at(-1)?.url || saved();
    if (!url) return;
    const controller = new AbortController();
    setLoading(true); setEntries(null); setLoadError("");
    void fetch("/api/google-drive/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not retrieve Google Drive files."); if (!controller.signal.aborted) setEntries(data.entries); })
      .catch(err => { if (!controller.signal.aborted) setLoadError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    onCleanup(() => controller.abort());
  }));
  function fileUrl(file: Entry, mode: "preview" | "download") {
    return `/api/google-drive/file/${mode}?${new URLSearchParams({ id: file.id, name: file.name, resourceKey: file.resourceKey || "" })}`;
  }
  function openFolder(file: Entry) {
    const url = new URL(`https://drive.google.com/drive/folders/${file.id}`);
    if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
    setFolders([...folders(), { name: file.name, url: url.href }]);
  }
  return <section class="nextcloud-section" aria-label="Google Drive">
    {saved() && props.toolbarTarget && <Portal mount={props.toolbarTarget}><NextcloudSettings service="Google Drive" url={saved()} loading={loading()} onRefresh={() => setRevision(n => n + 1)} onEdit={() => setEditing(true)} /></Portal>}
    {editing() && <form class="nextcloud-form" novalidate onSubmit={event => {
      event.preventDefault(); const url = folderUrl(input());
      if (!url) { setError("Enter a public Google Drive folder URL."); return; }
      try { localStorage.setItem(props.storageKey, url); setSaved(url); setInput(url); setFolders([]); setViewed(null); setEditing(false); setError(""); setRevision(n => n + 1); }
      catch { setError("Could not save the link. Check that local storage is enabled."); }
    }}>
      <label for="google-drive-url">Google Drive shared folder URL</label>
      <input ref={urlInput} id="google-drive-url" type="url" inputmode="url" autocomplete="off" spellcheck={false} value={input()} placeholder="https://drive.google.com/drive/folders/…" aria-invalid={Boolean(error())} aria-describedby={`google-drive-help${error() ? " google-drive-error" : ""}`} onInput={e => { setInput(e.currentTarget.value); setError(""); }} />
      <p id="google-drive-help" class="course-section-notice">Paste a public folder link. Files will appear here.</p>
      {error() && <p id="google-drive-error" class="nextcloud-error" role="alert">{error()}</p>}
      <div class="nextcloud-actions"><button class="nextcloud-save" type="submit">Save link</button>{saved() && <button type="button" onClick={() => { setInput(saved()); setEditing(false); setError(""); }}>Cancel</button>}</div>
    </form>}
    {saved() && <>
      {folders().length > 0 && <nav class="nextcloud-breadcrumbs" aria-label="Google Drive folder"><button type="button" onClick={() => setFolders([])}>All files</button><For each={folders()}>{(folder, index) => <span><ChevronRight size={14} aria-hidden="true"/><button type="button" disabled={index() === folders().length - 1} onClick={() => setFolders(folders().slice(0, index() + 1))}>{folder.name}</button></span>}</For></nav>}
      {loading() && <p class="nextcloud-loading" role="status"><LoaderCircle size={18} class="spin" /> Loading files…</p>}
      {loadError() && <div class="nextcloud-load-error" role="alert"><p>{loadError()}</p><button class="nextcloud-save" type="button" onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
      {entries() && <div class="file-grid nextcloud-files" aria-label="Google Drive files"><For each={entries()!}>{file => {
        const kind = nextcloudFileKind(file);
        const Icon = file.directory ? Folder : kind === "video" ? Film : kind === "audio" ? Headphones : kind === "image" ? Image : FileText;
        return <article class="file-card nextcloud-file">
          <button class="file-card-link" type="button" aria-label={`${file.directory ? "Open folder" : "Open"} ${file.name}`} aria-haspopup={file.directory ? undefined : "dialog"} onClick={() => file.directory ? openFolder(file) : setViewed(file)}>
            {!file.directory && (kind === "pdf" || kind === "image" || kind === "video") ? <FileThumbnail url={fileUrl(file, "preview")} version={file.etag} kind={kind} /> : <div class={`file-preview ${file.directory ? "folder" : kind}`}><Icon size={42} stroke-width={1.4} /><span class="file-type">{file.directory ? "Folder" : kind === "audio" ? "Audio" : file.name.split(".").pop()?.toUpperCase()}</span></div>}
            <div class="file-info"><h2 title={file.name}>{file.name}</h2></div>
          </button>
          {!file.directory && <a class="nextcloud-download" href={fileUrl(file, "download")} aria-label={`Download ${file.name}`}><Download size={17}/></a>}
        </article>;
      }}</For>{!entries()!.length && <p class="course-section-notice">No files in this folder yet.</p>}</div>}
    </>}
    <Show when={viewed()} keyed>{file => <NextcloudViewer file={file} contentUrl={fileUrl(file, "preview")} downloadUrl={fileUrl(file, "download")} onClose={() => setViewed(null)} />}</Show>
  </section>;
}
