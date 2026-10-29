import { useCallback, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { GitFork, LoaderCircle, Plus } from "lucide-react";
import { gitlabProjectList, normalizeGitlabProject, type GitlabProject as Project } from "../server/gitlab.js";
import { GitlabConnection } from "./GitlabConnection";
import { GitlabRepository } from "./GitlabRepository";
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
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить проект."); }
    finally { setBusy(false); }
  }
  return <form className="gitlab-form gitlab-project-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <label htmlFor="gitlab-project-url">Ссылка на проект GitLab</label>
    <input id="gitlab-project-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)}
      placeholder="https://gitlab.com/group/project" required maxLength={2048} autoComplete="off" spellCheck={false} disabled={busy} />
    <div className="gitlab-actions">
      <button className="primary-button" type="submit" disabled={busy || !url.trim()}>
        {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}{initialUrl ? "Сохранить" : "Добавить проект"}
      </button>
      {onCancel && <button className="text-button" type="button" disabled={busy} onClick={onCancel}>Отмена</button>}
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
        throw new Error("Этот проект GitLab уже добавлен к курсу.");
      const updated = url ? { id: projectId ?? url, url } : null;
      next = projectId ? projects.flatMap((item) => item.id === projectId ? updated ? [updated] : [] : [item])
        : updated ? [...projects, updated] : projects;
      localStorage.setItem(storageKey, JSON.stringify(next));
      setDemoProjects(next);
    } else next = await onSave(url, projectId);
    if (next) setSelectedId((url ? next.find((item) => item.url === url) : next[0])?.id ?? null);
    setAdding(false);
  }
  return <section className="gitlab-section" aria-label="GitLab">
    {projects.length > 0 && <div className="gitlab-project-bar">
      <div className="gitlab-project-list" role="group" aria-label="Проекты GitLab">
        {projects.map((item) => {
          const address = new URL(item.url);
          return <button key={item.id} type="button" className="gitlab-project-tab" title={item.url}
            aria-pressed={!adding && project?.id === item.id} onClick={() => { setSelectedId(item.id); setAdding(false); }}>
            <GitFork size={15} aria-hidden="true" /><span><strong>{address.pathname.slice(1)}</strong><small>{address.host}</small></span>
          </button>;
        })}
      </div>
      <button className="text-button gitlab-add-project" type="button" aria-expanded={adding} onClick={() => setAdding(true)}>
        <Plus size={16} aria-hidden="true" />Добавить проект
      </button>
    </div>}
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
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось отвязать проект."); }
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
