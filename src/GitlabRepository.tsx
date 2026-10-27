import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowLeft, ChevronRight, Folder, FolderOpen, LoaderCircle } from "lucide-react";
import { GitlabBranchPicker } from "./GitlabBranchPicker";
import { GitlabCommitSummary } from "./GitlabCommitSummary";
import { RepositoryFileIcon } from "./RepositoryFileIcon";
import { GitlabFileViewer } from "./GitlabFileViewer";
import { demoCommits, GitlabHistory } from "./GitlabHistory";
import { GitlabCommitViewer } from "./GitlabCommitViewer";
import { GitlabApiError, gitlabApi, type GitlabEntry, type GitlabListing, type GitlabBranch, type GitlabCommit } from "./gitlab-api";

type FolderState = { entries: GitlabEntry[]; loading: boolean; error: string | null };

export function GitlabRepository({ endpoint, projectUrl, revision, demo, onAuthRequired }: {
  endpoint: string; projectUrl: string; revision: number; demo: boolean; onAuthRequired: () => void;
}) {
  const [folders, setFolders] = useState<Record<string, FolderState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const expandedRef = useRef(expanded);
  const [branch, setBranch] = useState<string | null>(null);
  const branchRef = useRef<string | null>(null);
  const [requestedBranch, setRequestedBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitlabBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchesRetry, setBranchesRetry] = useState(0);
  const [view, setView] = useState<"files" | "history">("files");
  const [selectedCommit, setSelectedCommit] = useState<GitlabCommit | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setBranchesLoading(true); setBranchesError(null); setBranches([]);
    const request = demo ? Promise.resolve({ branches: ["main", "develop"].map((name) => ({ name, default: name === "main", commit: demoCommits(projectUrl, name)[0] })) })
      : gitlabApi<{ branches: GitlabBranch[] }>(`${endpoint}/branches`, controller.signal);
    void request.then((value) => { if (!controller.signal.aborted) setBranches(value.branches); })
      .catch((error) => { if (!controller.signal.aborted) {
        setBranchesError(error.message || "Не удалось загрузить ветки.");
        if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") onAuthRequired();
      } }).finally(() => { if (!controller.signal.aborted) setBranchesLoading(false); });
    return () => controller.abort();
  }, [endpoint, projectUrl, revision, demo, onAuthRequired, branchesRetry]);
  const [selected, setSelected] = useState<GitlabEntry | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const tree = useRef<HTMLUListElement>(null);
  const loadFolder = useRef<(path: string) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let currentBranch: string | null = requestedBranch || branchRef.current;
    const cache: Record<string, FolderState> = Object.create(null);
    const requests = new Map<string, AbortController>();
    setFolders({});
    async function load(path: string) {
      if (cancelled || cache[path]?.loading || (cache[path] && !cache[path].error)) return;
      const controller = new AbortController(); requests.set(path, controller);
      cache[path] = { entries: [], loading: true, error: null }; setFolders({ ...cache });
      try {
        const value = demo ? { branch: currentBranch || "main", path, entries: path
          ? [{ path: `${path}/index.ts`, name: "index.ts", directory: false }]
          : [{ path: "src", name: "src", directory: true }, { path: "README.md", name: "README.md", directory: false }, { path: "package.json", name: "package.json", directory: false }] }
          : await gitlabApi<GitlabListing>(`${endpoint}/tree?${new URLSearchParams({ path, ...(currentBranch ? { ref: currentBranch } : {}) })}`, controller.signal);
        if (cancelled) return;
        currentBranch = value.branch; branchRef.current = value.branch; setBranch(value.branch);
        cache[path] = { entries: value.entries, loading: false, error: null }; setFolders({ ...cache });
        if (!path) setFocused(value.entries[0]?.path ?? null);
        for (const entry of value.entries)
          if (entry.directory && expandedRef.current.has(entry.path)) void load(entry.path);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        cache[path] = { entries: [], loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить папку." };
        setFolders({ ...cache });
        if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") onAuthRequired();
      } finally { requests.delete(path); }
    }
    loadFolder.current = (path) => { void load(path); };
    void load("");
    return () => { cancelled = true; requests.forEach((controller) => controller.abort()); };
  }, [endpoint, projectUrl, revision, demo, onAuthRequired, requestedBranch]);

  function focusPath(path: string) {
    let target = tree.current?.querySelector<HTMLElement>(`[data-entry-path="${CSS.escape(path)}"]`);
    let parent = path;
    while (!target && parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      target = tree.current?.querySelector<HTMLElement>(`[data-entry-path="${CSS.escape(parent)}"]`);
    }
    target ??= tree.current?.querySelector<HTMLElement>('[role="treeitem"]');
    setFocused(target?.dataset.entryPath ?? path);
    target?.focus({ preventScroll: true });
  }
  function toggle(entry: GitlabEntry, open = !expanded.has(entry.path)) {
    const next = new Set(expandedRef.current);
    if (open) { next.add(entry.path); loadFolder.current(entry.path); } else next.delete(entry.path);
    expandedRef.current = next; setExpanded(next); focusPath(entry.path);
  }
  function activate(entry: GitlabEntry) {
    focusPath(entry.path);
    if (entry.directory) toggle(entry); else setSelected(entry);
  }
  function keyboard(event: KeyboardEvent<HTMLLIElement>, entry: GitlabEntry) {
    if (event.target !== event.currentTarget) return;
    const rows = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const index = rows.indexOf(event.currentTarget);
    let target: HTMLElement | undefined | null;
    if (event.key === "ArrowDown") target = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
    else if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows[rows.length - 1];
    else if (event.key === "ArrowRight" && entry.directory) {
      event.preventDefault();
      if (!expanded.has(entry.path)) toggle(entry, true);
      else target = event.currentTarget.querySelector<HTMLElement>('[role="group"] [role="treeitem"]');
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (entry.directory && expanded.has(entry.path)) toggle(entry, false);
      else target = event.currentTarget.parentElement?.closest<HTMLElement>('[role="treeitem"]');
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(entry); }
    else if (event.key === "Escape" && selected) { event.preventDefault(); setSelected(null); }
    if (target) { event.preventDefault(); focusPath(target.dataset.entryPath!); target.scrollIntoView({ block: "nearest" }); }
  }
  function click(event: MouseEvent<HTMLLIElement>, entry: GitlabEntry) {
    if ((event.target as Element).closest('[role="treeitem"]') === event.currentTarget) { event.stopPropagation(); activate(entry); }
  }
  function status(path: string, depth: number) {
    const state = folders[path];
    return state?.error ? <li role="none" className="gitlab-tree-status" style={{ paddingLeft: depth * 14 + 6 }}>
      <p role="alert">{state.error}</p><button className="text-button" onClick={(event) => { event.stopPropagation(); loadFolder.current(path); }}>Повторить</button>
    </li> : !state || state.loading ? <li role="none" className="gitlab-tree-status" style={{ paddingLeft: depth * 14 + 6 }}>
      <span role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" />Загрузка…</span>
    </li> : !state.entries.length ? <li role="none" className="gitlab-tree-status" style={{ paddingLeft: depth * 14 + 6 }}>Папка пуста</li> : null;
  }
  function children(path: string, depth: number): React.ReactNode {
    const state = folders[path];
    if (!state || state.loading || state.error || !state.entries.length) return status(path, depth);
    return state.entries.map((entry) => {
      const open = expanded.has(entry.path);
      const Icon = open ? FolderOpen : Folder;
      return <li key={entry.path} role="treeitem" data-entry-path={entry.path} tabIndex={focused === entry.path ? 0 : -1}
        aria-label={entry.name} aria-level={depth + 1} aria-expanded={entry.directory ? open : undefined}
        aria-selected={!entry.directory ? selected?.path === entry.path : undefined}
        onFocus={(event) => { if (event.target === event.currentTarget) setFocused(entry.path); }}
        onClick={(event) => click(event, entry)} onKeyDown={(event) => keyboard(event, entry)}>
        <div className="gitlab-tree-row" style={{ paddingLeft: depth * 14 + 6 }} title={entry.path}>
          {entry.directory ? <ChevronRight className={open ? "expanded" : undefined} size={13} aria-hidden="true" /> : <span className="gitlab-tree-spacer" />}
          {entry.directory ? <Icon size={15} strokeWidth={1.6} aria-hidden="true" /> : <RepositoryFileIcon name={entry.name} />}<span className="gitlab-tree-name">{entry.name}</span>
        </div>
        {entry.directory && open && <ul role="group">{children(entry.path, depth + 1)}</ul>}
      </li>;
    });
  }
  const activeBranch = requestedBranch || branch || branches.find((item) => item.default)?.name || "";
  const commit = branches.find((item) => item.name === activeBranch)?.commit;
  const displayedCommit = (view === "history" ? selectedCommit : null) || commit || null;
  function toggleHistory() {
    if (view === "history") setView("files");
    else { setSelectedCommit((previous) => previous || commit || null); setView("history"); }
  }
  return <div className="gitlab-browser">
        <div className="gitlab-repo-toolbar">
          <GitlabBranchPicker branches={branches} value={activeBranch} loading={branchesLoading} onChange={(next) => {
            setSelected(null); setSelectedCommit(null); setFolders({}); setFocused(null);
            const empty = new Set<string>(); expandedRef.current = empty; setExpanded(empty);
            branchRef.current = next; setBranch(next); setRequestedBranch(next);
          }} />
          {branchesError && <button className="gitlab-branches-error" title={branchesError} onClick={() => setBranchesRetry((value) => value + 1)}>Повторить загрузку веток</button>}
        </div>
      <aside className="gitlab-repo-sidebar" aria-label="Репозиторий GitLab">
        {view === "history" && <button type="button" className="gitlab-history-back" onClick={() => setView("files")}><ArrowLeft size={14} aria-hidden="true" />К файлам</button>}
        {view === "history" ? activeBranch ? <GitlabHistory key={`${activeBranch}:${revision}`} endpoint={endpoint} branch={activeBranch} projectUrl={projectUrl}
          demo={demo} selected={selectedCommit?.id ?? null} onSelect={setSelectedCommit} onAuthRequired={onAuthRequired} />
          : <div className="gitlab-history-pane"><p className="gitlab-history-status">{branchesLoading ? "Загружаем ветки…" : "Нет доступной ветки для просмотра истории."}</p></div>
          : <nav className="gitlab-tree-pane" aria-label="Файлы репозитория">
          <ul ref={tree} className="gitlab-tree" role="tree" aria-label="Файлы GitLab">{children("", 0)}</ul>
        </nav>}
      </aside>
      <div className="gitlab-preview-pane">
        <GitlabCommitSummary key={displayedCommit?.id || activeBranch} commit={displayedCommit} loading={branchesLoading}
          historyOpen={view === "history"} historyDisabled={!activeBranch} onToggleHistory={toggleHistory}
          onOpen={() => { if (displayedCommit) { setView("history"); setSelectedCommit(displayedCommit); } }} />
        <div className="gitlab-preview-content">
        {view === "history" ? selectedCommit ? <GitlabCommitViewer key={`${activeBranch}:${selectedCommit.id}:${revision}`} commit={selectedCommit} endpoint={endpoint}
          demo={demo} onAuthRequired={onAuthRequired} /> : <div className="gitlab-preview-empty"><span>Выбери коммит в истории</span></div>
          : selected ? <GitlabFileViewer key={`${activeBranch}:${selected.path}:${revision}`} entry={selected} endpoint={endpoint} projectUrl={projectUrl}
          branch={branch} demo={demo} embedded onClose={() => { const path = selected.path; setSelected(null); focusPath(path); }} />
          : <div className="gitlab-preview-empty"><span>Выбери файл в дереве</span></div>}
        </div>
      </div>
    </div>;
}
