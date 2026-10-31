import { FolderOpen, LoaderCircle, X } from "lucide-solid";
import { createSignal, createUniqueId, onCleanup, onMount } from "solid-js";

export function createIdeaProject(projectUrl: string) {
  const key = `stud-gk-idea-project:${projectUrl}`;
  let saved = "";
  try { saved = localStorage.getItem(key) || ""; } catch {}
  const [path, setPath] = createSignal(saved);
  const [draft, setDraft] = createSignal(saved);
  const [configuring, setConfiguring] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal("");
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(feedbackTimer));

  function configure() { setDraft(path()); setError(""); setStatus(""); setConfiguring(true); }
  async function launch(directory: string, save = false) {
    if (busy() || !window.studGkDesktop) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await window.studGkDesktop.openIdeaProject(directory);
      if (save && result.path) {
        // Keep validated paths even when the launcher is missing, but never save an invalid folder.
        try { localStorage.setItem(key, result.path); }
        catch { throw new Error("Could not save the local path on this device. Check your application storage and retry."); }
        setPath(result.path);
      }
      if (!result.ok) throw new Error(result.error);
      setConfiguring(false);
      setStatus("Launch request sent to IDEA");
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => setStatus(""), 4000);
    } catch (error) {
      setDraft(directory); setConfiguring(true);
      setError(error instanceof Error ? error.message : "Could not open the project in IDEA.");
    } finally { setBusy(false); }
  }
  return {
    path, draft, setDraft, configuring, busy, error, status, configure,
    open: () => path() ? void launch(path()) : configure(),
    save: () => launch(draft().trim(), true),
    close: () => { if (!busy()) setConfiguring(false); },
    browse: async () => {
      if (busy() || !window.studGkDesktop) return;
      setBusy(true); setError("");
      try { const selected = await window.studGkDesktop.chooseProjectDirectory(); if (selected) setDraft(selected); }
      catch { setError("Could not choose a folder. Enter its full path below."); }
      finally { setBusy(false); }
    },
  };
}

export function IdeaProjectDialog(props: { projectUrl: string; idea: ReturnType<typeof createIdeaProject> }) {
  let dialog!: HTMLDialogElement;
  const id = createUniqueId();
  onMount(() => { dialog.showModal(); });
  onCleanup(() => dialog.close());
  return <dialog ref={dialog} class="idea-project-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={(event) => { event.preventDefault(); props.idea.close(); }}>
    <header>
      <span class="idea-project-icon" aria-hidden="true">IJ</span>
      <h2 id={`${id}-title`}>Open in IntelliJ IDEA</h2>
      <button type="button" aria-label="Close IDEA setup" disabled={props.idea.busy()} onClick={props.idea.close}><X size={18} /></button>
    </header>
    <form onSubmit={(event) => { event.preventDefault(); void props.idea.save(); }} aria-busy={props.idea.busy()}>
      <p id={`${id}-description`}>Choose the folder where you cloned this repository. You only need to set this up once for each project on this device.</p>
      <div class="idea-project-repository"><span>GitLab repository</span><strong>{new URL(props.projectUrl).pathname.slice(1)}</strong></div>
      <label for={`${id}-path`}>Local project folder</label>
      <div class="idea-project-path">
        <input id={`${id}-path`} autofocus value={props.idea.draft()} onInput={(event) => props.idea.setDraft(event.currentTarget.value)}
          placeholder="/home/you/IdeaProjects/project" required maxLength={4096} autocomplete="off" spellcheck={false}
          aria-describedby={`${id}-hint`} disabled={props.idea.busy()} />
        <button type="button" class="idea-browse" onClick={() => void props.idea.browse()} disabled={props.idea.busy()}><FolderOpen size={15} aria-hidden="true" />Browse…</button>
      </div>
      <p id={`${id}-hint`} class="idea-project-hint">Use the full path to an existing local folder. The path stays on this device.</p>
      <p class="idea-project-note">Opens your local checkout. The branch selected in Stud.GK does not change your local branch.</p>
      {props.idea.error() && <p class="idea-project-error" role="alert">{props.idea.error()}</p>}
      <div class="idea-project-actions">
        <button type="button" class="text-button" onClick={props.idea.close} disabled={props.idea.busy()}>Cancel</button>
        <button type="submit" class="primary-button" disabled={props.idea.busy() || !props.idea.draft().trim()}>
          {props.idea.busy() && <LoaderCircle size={14} class="spin" aria-hidden="true" />}Save and open
        </button>
      </div>
    </form>
  </dialog>;
}
