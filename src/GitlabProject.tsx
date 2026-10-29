import { useCallback, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { normalizeGitlabProject, type GitlabProject as Project } from "../server/gitlab.js";
import { GitlabConnection } from "./GitlabConnection";
import { GitlabRepository } from "./GitlabRepository";
import { GitlabSettings } from "./GitlabSettings";
import "./gitlab.css";

export function GitlabProject({ courseId, project: savedProject, demo, onSave, toolbarTarget }: {
  courseId: string; project: Project | null; demo: boolean;
  onSave: (url: string | null) => Promise<void>; toolbarTarget?: HTMLElement | null;
}) {
  const storageKey = `stud-gk-demo-gitlab:${courseId}`;
  const [demoProject, setDemoProject] = useState<Project | null>(() => {
    if (!demo) return null;
    try { const saved = localStorage.getItem(storageKey); return saved ? normalizeGitlabProject(saved) : null; }
    catch { return null; }
  });
  const project = demo ? demoProject : savedProject;
  const [editing, setEditing] = useState(false), [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false), [authRequired, setAuthRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  const requireAuth = useCallback(() => setAuthRequired(true), []);
  const endpoint = `/api/courses/${encodeURIComponent(courseId)}/gitlab`;
  async function save(value: string | null) {
    setError(null); setBusy(true);
    try {
      const next = value === null ? null : normalizeGitlabProject(value);
      if (demo) {
        if (next) localStorage.setItem(storageKey, next.url); else localStorage.removeItem(storageKey);
        setDemoProject(next);
      } else await onSave(next?.url ?? null);
      setEditing(false); setUrl(""); setConnectionOpen(false); setAuthRequired(false); setRevision((value) => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the project."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(url); }
  const settings = project ? <GitlabSettings url={project.url} onRefresh={() => setRevision((value) => value + 1)}
    onEdit={() => { setUrl(project.url); setEditing(true); setConnectionOpen(false); }}
    onAccess={demo ? undefined : () => { setConnectionOpen(true); setEditing(false); }} onUnlink={() => void save(null)} /> : null;
  return <section className="gitlab-section" aria-label="GitLab" aria-busy={busy}>
    {settings && (toolbarTarget ? createPortal(settings, toolbarTarget) : <div className="gitlab-local-toolbar">{settings}</div>)}
    {(!project || editing) && <form className="gitlab-form gitlab-project-form" onSubmit={submit}>
      <label htmlFor="gitlab-project-url">GitLab project URL</label>
      <input id="gitlab-project-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)}
        placeholder="https://gitlab.com/group/project" required maxLength={2048} autoComplete="off" spellCheck={false} disabled={busy} />
      <div className="gitlab-actions">
        <button className="primary-button" type="submit" disabled={busy || !url.trim()}>
          {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{project ? "Save" : "Add project"}
        </button>
        {project && <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {project && !editing && <>
      {!demo && (connectionOpen || authRequired) && <GitlabConnection endpoint={endpoint} projectUrl={project.url}
        onConnected={() => { setConnectionOpen(false); setAuthRequired(false); setRevision((value) => value + 1); }}
        onCancel={() => { setConnectionOpen(false); setAuthRequired(false); }} />}
      <GitlabRepository key={project.url} endpoint={endpoint} projectUrl={project.url} revision={revision} demo={demo} onAuthRequired={requireAuth} />
    </>}
  </section>;
}
