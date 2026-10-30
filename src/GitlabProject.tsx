import { useCallback, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { gitlabProjectList, normalizeGitlabProject, type GitlabProject as Project } from "../server/gitlab.js";
import { GitlabConnection } from "./GitlabConnection";
import { GitlabRepository } from "./GitlabRepository";
import { GitlabProjectPicker } from "./GitlabProjectPicker";
import { GitlabSettings } from "./GitlabSettings";
import "./gitlab.css";

function ProjectForm({ initialUrl = "", onSave, onCancel }: {
  initialUrl?: string; onSave: (url: string) => Promise<void>; onCancel?: () => void;
}) {
  const [url, setUrl] = useState(initialUrl), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    try { await onSave(normalizeGitlabProject(url).url); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save the project."); }
    finally { setBusy(false); }
  }
  return <form className="gitlab-form gitlab-project-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <label htmlFor="gitlab-project-url">GitLab project URL</label>
    <input id="gitlab-project-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)}
      placeholder="https://gitlab.com/group/project" required maxLength={2048} autoComplete="off" spellCheck={false} disabled={busy} />
    <div className="gitlab-actions">
      <button className="primary-button" type="submit" disabled={busy || !url.trim()}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{initialUrl ? "Save" : "Add project"}
      </button>
      {onCancel && <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

export function GitlabProject({ courseId, projects: savedProjects, demo, onSave, toolbarTarget }: {
  courseId: string; projects: Project[]; demo: boolean;
  onSave: (url: string | null, projectId?: string) => Promise<Project[] | undefined>; toolbarTarget?: HTMLElement | null;
}) {
  const storageKey = `stud-gk-demo-gitlab:${courseId}`;
  const [demoProjects, setDemoProjects] = useState<Project[]>(() => {
    if (!demo) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return [];
      try { return gitlabProjectList(JSON.parse(saved)); }
      catch { return [{ id: "legacy", ...normalizeGitlabProject(saved) }]; }
    } catch { return []; }
  });
  const projects = demo ? demoProjects : savedProjects;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const project = projects.find((item) => item.id === selectedId) ?? projects[0];
  async function save(url: string | null, projectId?: string) {
    let next: Project[] | undefined;
    if (demo) {
      if (url && projects.some((item) => item.id !== projectId && item.url === url))
        throw new Error("This GitLab project is already linked to the course.");
      const updated = url ? { id: projectId ?? url, url } : null;
      next = projectId ? projects.flatMap((item) => item.id === projectId ? updated ? [updated] : [] : [item])
        : updated ? [...projects, updated] : projects;
      localStorage.setItem(storageKey, JSON.stringify(next));
      setDemoProjects(next);
    } else next = await onSave(url, projectId);
    if (next) setSelectedId((url ? next.find((item) => item.url === url) : next[0])?.id ?? null);
    setAdding(false);
  }
  const picker = project ? <GitlabProjectPicker projects={projects} selected={project} adding={adding}
    onSelect={(id) => { setSelectedId(id); setAdding(false); }} onAdd={() => setAdding(true)} /> : null;
  return <section className="gitlab-section" aria-label="GitLab">
    {picker && (toolbarTarget ? createPortal(picker, toolbarTarget) : <div className="gitlab-local-toolbar">{picker}</div>)}
    {(!projects.length || adding) ? <ProjectForm onSave={(url) => save(url)} onCancel={projects.length ? () => setAdding(false) : undefined} />
      : project && <ProjectView key={`${project.id}:${project.url}`} courseId={courseId} project={project} demo={demo}
        onSave={(url) => save(url, project.id)} toolbarTarget={toolbarTarget} />}
  </section>;
}

function ProjectView({ courseId, project, demo, onSave, toolbarTarget }: {
  courseId: string; project: Project; demo: boolean; onSave: (url: string | null) => Promise<void>; toolbarTarget?: HTMLElement | null;
}) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false), [authRequired, setAuthRequired] = useState(false);
  const [revision, setRevision] = useState(0);
  const requireAuth = useCallback(() => setAuthRequired(true), []);
  const endpoint = `/api/courses/${encodeURIComponent(courseId)}/gitlab/projects/${encodeURIComponent(project.id)}`;
  async function unlink() {
    setBusy(true); setError(null);
    try { await onSave(null); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not unlink the project."); }
    finally { setBusy(false); }
  }
  const settings = <GitlabSettings url={project.url} onRefresh={() => setRevision((value) => value + 1)}
    onEdit={() => { setEditing(true); setConnectionOpen(false); }}
    onAccess={demo ? undefined : () => { setConnectionOpen(true); setEditing(false); }} onUnlink={() => { if (!busy) void unlink(); }} />;
  return <div className="gitlab-project-view" aria-busy={busy}>
    {toolbarTarget ? createPortal(settings, toolbarTarget) : <div className="gitlab-local-toolbar">{settings}</div>}
    {editing ? <ProjectForm initialUrl={project.url} onSave={async (url) => { await onSave(url); setEditing(false); }} onCancel={() => setEditing(false)} /> : <>
      {!demo && (connectionOpen || authRequired) && <GitlabConnection endpoint={endpoint} projectUrl={project.url}
        onConnected={() => { setConnectionOpen(false); setAuthRequired(false); setRevision((value) => value + 1); }}
        onCancel={() => { setConnectionOpen(false); setAuthRequired(false); }} />}
      <GitlabRepository endpoint={endpoint} projectUrl={project.url} revision={revision} demo={demo} onAuthRequired={requireAuth} />
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
