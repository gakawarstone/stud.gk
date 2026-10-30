import { LoaderCircle } from "lucide-solid";
import { batch, createMemo, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { gitlabProjectList, normalizeGitlabProject, type GitlabProject as Project } from "../server/gitlab.js";
import { GitlabConnection } from "./GitlabConnection";
import { GitlabRepository } from "./GitlabRepository";
import { GitlabProjectPicker } from "./GitlabProjectPicker";
import { GitlabSettings } from "./GitlabSettings";
import "./gitlab.css";

function ProjectForm(props: { initialUrl?: string; onSave: (url: string) => Promise<void>; onCancel?: () => void }) {
  const [url, setUrl] = createSignal(props.initialUrl ?? ""),
    [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await props.onSave(normalizeGitlabProject(url()).url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form class="gitlab-form gitlab-project-form" onSubmit={(event) => void submit(event)} aria-busy={busy()}>
      <label for="gitlab-project-url">GitLab project URL</label>
      <input
        id="gitlab-project-url"
        type="url"
        value={url()}
        onInput={(event) => setUrl(event.currentTarget.value)}
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
          {props.initialUrl ? "Save" : "Add project"}
        </button>
        {props.onCancel && (
          <button class="text-button" type="button" disabled={busy()} onClick={() => props.onCancel?.()}>
            Cancel
          </button>
        )}
      </div>
      {error() && (
        <p class="form-error" role="alert">
          {error()}
        </p>
      )}
    </form>
  );
}

export function GitlabProject(props: {
  courseId: string;
  projects: Project[];
  demo: boolean;
  onSave: (url: string | null, projectId?: string) => Promise<Project[] | undefined>;
  toolbarTarget?: HTMLElement | null;
}) {
  const storageKey = () => `stud-gk-demo-gitlab:${props.courseId}`;
  const [demoProjects, setDemoProjects] = createSignal<Project[]>(
    (() => {
      if (!props.demo) return [];
      try {
        const saved = localStorage.getItem(storageKey());
        if (!saved) return [];
        try {
          return gitlabProjectList(JSON.parse(saved));
        } catch {
          return [{ id: "legacy", ...normalizeGitlabProject(saved) }];
        }
      } catch {
        return [];
      }
    })(),
  );
  const projects = createMemo(() => (props.demo ? demoProjects() : props.projects));
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);
  const project = createMemo(() => projects().find((item) => item.id === selectedId()) ?? projects()[0]);
  async function save(url: string | null, projectId?: string) {
    let next: Project[] | undefined;
    if (props.demo) {
      if (url && projects().some((item) => item.id !== projectId && item.url === url))
        throw new Error("This GitLab project is already linked to the course.");
      const updated = url ? { id: projectId ?? url, url } : null;
      next = projectId
        ? projects().flatMap((item) => (item.id === projectId ? (updated ? [updated] : []) : [item]))
        : updated
          ? [...projects(), updated]
          : projects();
      localStorage.setItem(storageKey(), JSON.stringify(next));
      batch(() => {
        setDemoProjects(next!);
        setSelectedId((url ? next!.find((item) => item.url === url) : next![0])?.id ?? null);
      });
    } else {
      next = await props.onSave(url, projectId);
      if (next) setSelectedId((url ? next.find((item) => item.url === url) : next[0])?.id ?? null);
    }
    setAdding(false);
  }
  const picker = () => (
    <GitlabProjectPicker
      projects={projects()}
      selected={project() ?? null}
      adding={adding()}
      onSelect={(id) =>
        batch(() => {
          setSelectedId(id);
          setAdding(false);
        })
      }
      onAdd={() => setAdding(true)}
    />
  );
  return (
    <section class="gitlab-section" aria-label="GitLab">
      {project() &&
        (props.toolbarTarget ? (
          <Portal mount={props.toolbarTarget} ref={(container) => props.toolbarTarget?.prepend(container)}>
            {picker()}
          </Portal>
        ) : (
          <div class="gitlab-local-toolbar">{picker()}</div>
        ))}
      {!projects().length || adding() ? (
        <ProjectForm onSave={(url) => save(url)} onCancel={projects().length ? () => setAdding(false) : undefined} />
      ) : (
        <Show when={project() ? `${project()!.id}:${project()!.url}` : null} keyed>
          {(_key) => {
            const current = project()!;
            return (
              <ProjectView
                courseId={props.courseId}
                project={current}
                demo={props.demo}
                onSave={(url) => save(url, current.id)}
                toolbarTarget={props.toolbarTarget}
              />
            );
          }}
        </Show>
      )}
    </section>
  );
}

function ProjectView(props: {
  courseId: string;
  project: Project;
  demo: boolean;
  onSave: (url: string | null) => Promise<void>;
  toolbarTarget?: HTMLElement | null;
}) {
  const [editing, setEditing] = createSignal(false),
    [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [connectionOpen, setConnectionOpen] = createSignal(false),
    [authRequired, setAuthRequired] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const requireAuth = () => setAuthRequired(true);
  const endpoint = () =>
    `/api/courses/${encodeURIComponent(props.courseId)}/gitlab/projects/${encodeURIComponent(props.project.id)}`;
  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await props.onSave(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not unlink the project.");
    } finally {
      setBusy(false);
    }
  }
  const settings = () => (
    <GitlabSettings
      url={props.project.url}
      onRefresh={() => setRevision((value) => value + 1)}
      onEdit={() =>
        batch(() => {
          setEditing(true);
          setConnectionOpen(false);
        })
      }
      onAccess={
        props.demo
          ? undefined
          : () =>
              batch(() => {
                setConnectionOpen(true);
                setEditing(false);
              })
      }
      onUnlink={() => {
        if (!busy()) void unlink();
      }}
    />
  );
  return (
    <div class="gitlab-project-view" aria-busy={busy()}>
      {props.toolbarTarget ? (
        <Portal mount={props.toolbarTarget}>{settings()}</Portal>
      ) : (
        <div class="gitlab-local-toolbar">{settings()}</div>
      )}
      {editing() ? (
        <ProjectForm
          initialUrl={props.project.url}
          onSave={async (url) => {
            await props.onSave(url);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {!props.demo && (connectionOpen() || authRequired()) && (
            <GitlabConnection
              endpoint={endpoint()}
              projectUrl={props.project.url}
              onConnected={() =>
                batch(() => {
                  setConnectionOpen(false);
                  setAuthRequired(false);
                  setRevision((value) => value + 1);
                })
              }
              onCancel={() =>
                batch(() => {
                  setConnectionOpen(false);
                  setAuthRequired(false);
                })
              }
            />
          )}
          <GitlabRepository
            endpoint={endpoint()}
            projectUrl={props.project.url}
            revision={revision()}
            demo={props.demo}
            onAuthRequired={requireAuth}
          />
        </>
      )}
      {error() && (
        <p class="form-error" role="alert">
          {error()}
        </p>
      )}
    </div>
  );
}
