import { FileText, Folder, ChevronRight } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup } from "solid-js";

type Entry = { id: string; name: string; directory: boolean };
function folderUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.username || url.password || !/^\/drive\/(?:u\/\d+\/)?folders\/[\w-]{10,200}\/?$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
export function GoogleDriveSection(props: { storageKey: string }) {
  const [saved, setSaved] = createSignal((() => { try { return folderUrl(localStorage.getItem(props.storageKey) || "") || ""; } catch { return ""; } })());
  const [input, setInput] = createSignal(saved());
  const [editing, setEditing] = createSignal(!saved());
  const [folders, setFolders] = createSignal<{ name: string; url: string }[]>([]);
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  createEffect(on(() => [saved(), folders(), revision()] as const, () => {
    const url = folders().at(-1)?.url || saved();
    if (!url) return;
    const controller = new AbortController();
    setLoading(true); setEntries([]); setError("");
    fetch("/api/google-drive/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setEntries(data.entries); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    onCleanup(() => controller.abort());
  }));
  return <section class="nextcloud-section" aria-label="Google Drive">
    {editing() && <form class="nextcloud-form" onSubmit={event => {
      event.preventDefault(); const url = folderUrl(input());
      if (!url) { setError("Enter a public Google Drive folder URL."); return; }
      try { localStorage.setItem(props.storageKey, url); setSaved(url); setFolders([]); setEditing(false); setError(""); setRevision(n => n + 1); }
      catch { setError("Could not save the link. Check that local storage is enabled."); }
    }}>
      <label for="google-drive-url">Google Drive shared folder URL</label>
      <input id="google-drive-url" type="url" value={input()} placeholder="https://drive.google.com/drive/folders/…" onInput={e => setInput(e.currentTarget.value)} />
      <p class="course-section-notice">Paste a public folder link.</p>
      <div class="nextcloud-actions"><button class="nextcloud-save" type="submit">Save link</button>{saved() && <button type="button" onClick={() => { setInput(saved()); setEditing(false); setError(""); }}>Cancel</button>}</div>
    </form>}
    {saved() && <><div class="nextcloud-actions"><button type="button" onClick={() => setRevision(n => n + 1)}>Refresh</button><button type="button" onClick={() => setEditing(true)}>Edit link</button><a href={saved()} target="_blank" rel="noreferrer">Open in browser</a></div>
      <nav class="nextcloud-breadcrumbs" aria-label="Google Drive folder"><button type="button" onClick={() => setFolders([])}>All files</button><For each={folders()}>{(folder, index) => <span><ChevronRight size={14}/><button type="button" onClick={() => setFolders(folders().slice(0, index() + 1))}>{folder.name}</button></span>}</For></nav>
      {loading() && <p role="status">Loading files…</p>}
      <div class="file-grid nextcloud-files"><For each={entries()}>{file => <article class="file-card nextcloud-file">{file.directory ? <button class="file-card-link" type="button" onClick={() => setFolders([...folders(), {name: file.name, url: `https://drive.google.com/drive/folders/${file.id}`}])}><div class="file-preview folder"><Folder size={42}/></div><div class="file-info"><h2>{file.name}</h2></div></button> : <a class="file-card-link" href={`https://drive.google.com/file/d/${file.id}/view`} target="_blank" rel="noreferrer"><div class="file-preview"><FileText size={42}/></div><div class="file-info"><h2>{file.name}</h2></div></a>}</article>}</For></div>
      {!loading() && !error() && !entries().length && <p class="course-section-notice">No files in this folder yet.</p>}
    </>}
    {error() && <p class="nextcloud-error" role="alert">{error()}</p>}
  </section>;
}
