import { LoaderCircle } from "lucide-solid";
import { createMemo, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { normalizeGitlabProject, type GitlabProject as Project } from "../server/gitlab.js";
import { GitlabConnection } from "./GitlabConnection";
import { GitlabRepository } from "./GitlabRepository";
import { GitlabSettings } from "./GitlabSettings";
import "./gitlab.css";
export function GitlabProject(props: {
  courseId: string;
  project: Project | null;
  demo: boolean;
  onSave: (url: string | null) => Promise<void>;
  toolbarTarget?: HTMLElement | null;
}) {
  const storageKey = createMemo(() => `stud-gk-demo-gitlab:${props.courseId}`);
  const [demoProject, setDemoProject] = createSignal<Project | null>(
    (() => {
      if (!props.demo) return null;
      try {
        const saved = localStorage.getItem(storageKey());
        return saved ? normalizeGitlabProject(saved) : null;
      } catch {
        return null;
      }
    })(),
  );
  const project = createMemo(() => (props.demo ? demoProject() : props.project));
  const [editing, setEditing] = createSignal(false),
    [url, setUrl] = createSignal("");
  const [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal<string | null>(null);
  const [connectionOpen, setConnectionOpen] = createSignal(false),
    [authRequired, setAuthRequired] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const requireAuth = () => setAuthRequired(true);
  const endpoint = createMemo(() => `/api/courses/${encodeURIComponent(props.courseId)}/gitlab`);
  async function save(value: string | null) {
    setError(null);
    setBusy(true);
    try {
      const next = value === null ? null : normalizeGitlabProject(value);
      if (props.demo) {
        if (next) localStorage.setItem(storageKey(), next.url);
        else localStorage.removeItem(storageKey());
        setDemoProject(next);
      } else await props.onSave(next?.url ?? null);
      setEditing(false);
      setUrl("");
      setConnectionOpen(false);
      setAuthRequired(false);
      setRevision((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить проект.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    void save(url());
  }
  const settings = createMemo(() =>
    project() ? (
      <GitlabSettings
        url={project()!.url}
        onRefresh={() => setRevision((value) => value + 1)}
        onEdit={() => {
          setUrl(project()!.url);
          setEditing(true);
          setConnectionOpen(false);
        }}
        onAccess={
          props.demo
            ? undefined
            : () => {
                setConnectionOpen(true);
                setEditing(false);
              }
        }
        onUnlink={() => void save(null)}
      />
    ) : null,
  );
  return (
    <section class="gitlab-section" aria-label="GitLab" aria-busy={busy()}>
      {settings() &&
        (props.toolbarTarget ? (
          <Portal mount={props.toolbarTarget}>{settings()}</Portal>
        ) : (
          <div class="gitlab-local-toolbar">{settings()}</div>
        ))}
      {(!project() || editing()) && (
        <form class="gitlab-form gitlab-project-form" onSubmit={submit}>
          <label for="gitlab-project-url">Ссылка на проект GitLab</label>
          <input
            id="gitlab-project-url"
            type="url"
            value={url()}
            onInput={(event) => setUrl(event.target.value)}
            placeholder="https://gitlab.com/group/project"
            required
            maxlength={2048}
            autocomplete="off"
            spellcheck={false}
            disabled={busy()}
          />
          <div class="gitlab-actions">
            <button class="primary-button" type="submit" disabled={busy() || !url().trim()}>
              {busy() && <LoaderCircle size={14} class="spin" aria-hidden="true" />}
              {project() ? "Сохранить" : "Добавить проект"}
            </button>
            {project() && (
              <button class="text-button" type="button" disabled={busy()} onClick={() => setEditing(false)}>
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
      {error() && (
        <p class="form-error" role="alert">
          {error()}
        </p>
      )}
      {project() && !editing() && (
        <>
          {!props.demo && (connectionOpen() || authRequired()) && (
            <GitlabConnection
              endpoint={endpoint()}
              projectUrl={project()!.url}
              onConnected={() => {
                setConnectionOpen(false);
                setAuthRequired(false);
                setRevision((value) => value + 1);
              }}
              onCancel={() => {
                setConnectionOpen(false);
                setAuthRequired(false);
              }}
            />
          )}
          <Show when={project()!.url} keyed>
            {(_key) => (
              <GitlabRepository
                endpoint={endpoint()}
                projectUrl={project()!.url}
                revision={revision()}
                demo={props.demo}
                onAuthRequired={requireAuth}
              />
            )}
          </Show>
        </>
      )}
    </section>
  );
}
