import { ChevronRight, Folder, FolderOpen, LoaderCircle } from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { GitlabBranchPicker } from "./GitlabBranchPicker";
import { GitlabCommitSummary } from "./GitlabCommitSummary";
import { GitlabFileViewer } from "./GitlabFileViewer";
import { RepositoryFileIcon } from "./RepositoryFileIcon";
import {
  gitlabApi,
  GitlabApiError,
  type GitlabBranch,
  type GitlabEntry,
  type GitlabListing,
} from "./gitlab-api";
type FolderState = {
  entries: GitlabEntry[];
  loading: boolean;
  error: string | null;
};
export function GitlabRepository(props: {
  endpoint: string;
  projectUrl: string;
  revision: number;
  demo: boolean;
  onAuthRequired: () => void;
}) {
  const [folders, setFolders] = createSignal<Record<string, FolderState>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(
    (() => new Set())(),
  );
  let expandedRef = expanded();
  const [branch, setBranch] = createSignal<string | null>(null);
  let branchRef: (string | null) | null = null;
  const [requestedBranch, setRequestedBranch] = createSignal<string | null>(
    null,
  );
  const [branches, setBranches] = createSignal<GitlabBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = createSignal(true);
  const [branchesError, setBranchesError] = createSignal<string | null>(null);
  const [branchesRetry, setBranchesRetry] = createSignal(0);
  createEffect(
    on(
      () => [
        props.endpoint,
        props.projectUrl,
        props.revision,
        props.demo,
        props.onAuthRequired,
        branchesRetry(),
      ],
      () => {
        const controller = new AbortController();
        setBranchesLoading(true);
        setBranchesError(null);
        setBranches([]);
        const request = props.demo
          ? Promise.resolve({
              branches: ["main", "develop"].map((name) => ({
                name,
                default: name === "main",
                commit: null,
              })),
            })
          : gitlabApi<{
              branches: GitlabBranch[];
            }>(`${props.endpoint}/branches`, controller.signal);
        void request
          .then((value) => {
            if (!controller.signal.aborted) setBranches(value.branches);
          })
          .catch((error) => {
            if (!controller.signal.aborted) {
              setBranchesError(error.message || "Не удалось загрузить ветки.");
              if (
                error instanceof GitlabApiError &&
                error.code === "GITLAB_AUTH_REQUIRED"
              )
                props.onAuthRequired();
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setBranchesLoading(false);
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  const [selected, setSelected] = createSignal<GitlabEntry | null>(null);
  const [focused, setFocused] = createSignal<string | null>(null);
  let tree: HTMLUListElement | null = null;
  let loadFolder: (path: string) => void = () => {};
  createEffect(
    on(
      () => [
        props.endpoint,
        props.projectUrl,
        props.revision,
        props.demo,
        props.onAuthRequired,
        requestedBranch(),
      ],
      () => {
        let cancelled = false;
        let currentBranch: string | null = requestedBranch() || branchRef;
        const cache: Record<string, FolderState> = Object.create(null);
        const requests = new Map<string, AbortController>();
        setFolders({});
        async function load(path: string) {
          if (
            cancelled ||
            cache[path]?.loading ||
            (cache[path] && !cache[path].error)
          )
            return;
          const controller = new AbortController();
          requests.set(path, controller);
          cache[path] = { entries: [], loading: true, error: null };
          setFolders({ ...cache });
          try {
            const value = props.demo
              ? {
                  branch: currentBranch || "main",
                  path,
                  entries: path
                    ? [
                        {
                          path: `${path}/index.ts`,
                          name: "index.ts",
                          directory: false,
                        },
                      ]
                    : [
                        { path: "src", name: "src", directory: true },
                        {
                          path: "README.md",
                          name: "README.md",
                          directory: false,
                        },
                        {
                          path: "package.json",
                          name: "package.json",
                          directory: false,
                        },
                      ],
                }
              : await gitlabApi<GitlabListing>(
                  `${props.endpoint}/tree?${new URLSearchParams({ path, ...(currentBranch ? { ref: currentBranch } : {}) })}`,
                  controller.signal,
                );
            if (cancelled) return;
            currentBranch = value.branch;
            branchRef = value.branch;
            setBranch(value.branch);
            cache[path] = {
              entries: value.entries,
              loading: false,
              error: null,
            };
            setFolders({ ...cache });
            if (!path) setFocused(value.entries[0]?.path ?? null);
            for (const entry of value.entries)
              if (entry.directory && expandedRef.has(entry.path))
                void load(entry.path);
          } catch (error) {
            if (cancelled || controller.signal.aborted) return;
            cache[path] = {
              entries: [],
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Не удалось загрузить папку.",
            };
            setFolders({ ...cache });
            if (
              error instanceof GitlabApiError &&
              error.code === "GITLAB_AUTH_REQUIRED"
            )
              props.onAuthRequired();
          } finally {
            requests.delete(path);
          }
        }
        loadFolder = (path) => {
          void load(path);
        };
        void load("");
        onCleanup(() => {
          cancelled = true;
          requests.forEach((controller) => controller.abort());
        });
      },
    ),
  );
  function focusPath(path: string) {
    let target = tree?.querySelector<HTMLElement>(
      `[data-entry-path="${CSS.escape(path)}"]`,
    );
    let parent = path;
    while (!target && parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      target = tree?.querySelector<HTMLElement>(
        `[data-entry-path="${CSS.escape(parent)}"]`,
      );
    }
    target ??= tree?.querySelector<HTMLElement>('[role="treeitem"]');
    setFocused(target?.dataset.entryPath ?? path);
    target?.focus({ preventScroll: true });
  }
  function toggle(entry: GitlabEntry, open = !expanded().has(entry.path)) {
    const next = new Set(expandedRef);
    if (open) {
      next.add(entry.path);
      loadFolder(entry.path);
    } else next.delete(entry.path);
    expandedRef = next;
    setExpanded(next);
    focusPath(entry.path);
  }
  function activate(entry: GitlabEntry) {
    focusPath(entry.path);
    if (entry.directory) toggle(entry);
    else setSelected(entry);
  }
  function keyboard(
    event: KeyboardEvent & {
      currentTarget: HTMLLIElement;
    },
    entry: GitlabEntry,
  ) {
    if (event.target !== event.currentTarget) return;
    const rows = [
      ...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []),
    ];
    const index = rows.indexOf(event.currentTarget);
    let target: HTMLElement | undefined | null;
    if (event.key === "ArrowDown")
      target = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
    else if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows[rows.length - 1];
    else if (event.key === "ArrowRight" && entry.directory) {
      event.preventDefault();
      if (!expanded().has(entry.path)) toggle(entry, true);
      else
        target = event.currentTarget.querySelector<HTMLElement>(
          '[role="group"] [role="treeitem"]',
        );
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (entry.directory && expanded().has(entry.path)) toggle(entry, false);
      else
        target =
          event.currentTarget.parentElement?.closest<HTMLElement>(
            '[role="treeitem"]',
          );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(entry);
    } else if (event.key === "Escape" && selected()) {
      event.preventDefault();
      setSelected(null);
    }
    if (target) {
      event.preventDefault();
      focusPath(target.dataset.entryPath!);
      target.scrollIntoView({ block: "nearest" });
    }
  }
  function click(
    event: MouseEvent & {
      currentTarget: HTMLLIElement;
    },
    entry: GitlabEntry,
  ) {
    if (
      (event.target as Element).closest('[role="treeitem"]') ===
      event.currentTarget
    ) {
      event.stopPropagation();
      activate(entry);
    }
  }
  function status(path: string, depth: number) {
    const state = createMemo(() => folders()[path]);
    return state()?.error ? (
      <li
        role="none"
        class="gitlab-tree-status"
        style={{ "padding-left": `${depth * 14 + 6}px` }}
      >
        <p role="alert">{state().error}</p>
        <button
          class="text-button"
          onClick={(event) => {
            event.stopPropagation();
            loadFolder(path);
          }}
        >
          Повторить
        </button>
      </li>
    ) : !state() || state().loading ? (
      <li
        role="none"
        class="gitlab-tree-status"
        style={{ "padding-left": `${depth * 14 + 6}px` }}
      >
        <span role="status">
          <LoaderCircle size={13} class="spin" aria-hidden="true" />
          Загрузка…
        </span>
      </li>
    ) : !state().entries.length ? (
      <li
        role="none"
        class="gitlab-tree-status"
        style={{ "padding-left": `${depth * 14 + 6}px` }}
      >
        Папка пуста
      </li>
    ) : null;
  }
  function children(path: string, depth: number): JSX.Element {
    const state = createMemo(() => folders()[path]);
    if (!state() || state().loading || state().error || !state().entries.length)
      return status(path, depth);
    return (
      <For each={state().entries}>
        {(entry) => {
          const open = createMemo(() => expanded().has(entry.path));
          const Icon = createMemo(() => (open() ? FolderOpen : Folder));
          return (
            <li
              role="treeitem"
              data-entry-path={entry.path}
              tabindex={focused() === entry.path ? 0 : -1}
              aria-label={entry.name}
              aria-level={depth + 1}
              aria-expanded={entry.directory ? open() : undefined}
              aria-selected={
                !entry.directory ? selected()?.path === entry.path : undefined
              }
              onFocus={(event) => {
                if (event.target === event.currentTarget)
                  setFocused(entry.path);
              }}
              onClick={(event) => click(event, entry)}
              onKeyDown={(event) => keyboard(event, entry)}
            >
              <div
                class="gitlab-tree-row"
                style={{ "padding-left": `${depth * 14 + 6}px` }}
                title={entry.path}
              >
                {entry.directory ? (
                  <ChevronRight
                    class={open() ? "expanded" : undefined}
                    size={13}
                    aria-hidden="true"
                  />
                ) : (
                  <span class="gitlab-tree-spacer" />
                )}
                {entry.directory ? (
                  <Dynamic
                    component={Icon()}
                    size={15}
                    stroke-width={1.6}
                    aria-hidden="true"
                  />
                ) : (
                  <RepositoryFileIcon name={entry.name} />
                )}
                <span class="gitlab-tree-name">{entry.name}</span>
              </div>
              {entry.directory && open() && (
                <ul role="group">{children(entry.path, depth + 1)}</ul>
              )}
            </li>
          );
        }}
      </For>
    );
  }
  const activeBranch = createMemo(
    () =>
      requestedBranch() ||
      branch() ||
      branches().find((item) => item.default)?.name ||
      "",
  );
  const commit = createMemo(
    () => branches().find((item) => item.name === activeBranch())?.commit,
  );
  return (
    <div class="gitlab-browser">
      <aside class="gitlab-repo-sidebar" aria-label="Репозиторий GitLab">
        <div class="gitlab-sidebar-header">
          <GitlabBranchPicker
            branches={branches()}
            value={activeBranch()}
            loading={branchesLoading()}
            onChange={(next) => {
              setSelected(null);
              setFolders({});
              setFocused(null);
              const empty = new Set<string>();
              expandedRef = empty;
              setExpanded(empty);
              branchRef = next;
              setBranch(next);
              setRequestedBranch(next);
            }}
          />
          {branchesError() && (
            <button
              class="gitlab-branches-error"
              title={branchesError() || undefined}
              onClick={() => setBranchesRetry((value) => value + 1)}
            >
              Повторить загрузку веток
            </button>
          )}
        </div>
        <nav class="gitlab-tree-pane" aria-label="Файлы репозитория">
          <ul
            ref={(element) => (tree = element)}
            class="gitlab-tree"
            role="tree"
            aria-label="Файлы GitLab"
          >
            {children("", 0)}
          </ul>
        </nav>
        <Show when={commit()} keyed>
          {(value) => <GitlabCommitSummary commit={value} />}
        </Show>
      </aside>
      <div class="gitlab-preview-pane">
        <Show
          when={selected()}
          keyed
          fallback={
            <div class="gitlab-preview-empty">
              <span>Выбери файл в дереве</span>
            </div>
          }
        >
          {(entry) => (
            <Show
              when={`${activeBranch()}:${entry.path}:${props.revision}`}
              keyed
            >
              {(_key) => (
                <GitlabFileViewer
                  entry={entry}
                  endpoint={props.endpoint}
                  projectUrl={props.projectUrl}
                  branch={branch()}
                  demo={props.demo}
                  embedded
                  onClose={() => {
                    setSelected(null);
                    focusPath(entry.path);
                  }}
                />
              )}
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}
