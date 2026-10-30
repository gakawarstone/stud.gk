import { useEffect, useState } from "react";
import { GitCommitHorizontal, LoaderCircle } from "lucide-react";
import { GitlabApiError, gitlabApi, type GitlabCommit, type GitlabHistory as History } from "./gitlab-api";

export function demoCommits(projectUrl: string, branch: string): GitlabCommit[] {
  return ["Update course materials", "Add example", "Create repository"].map((title, index) => ({
    id: (branch === "develop" ? "def" : "abc")[index].repeat(40), shortId: (branch === "develop" ? "def" : "abc")[index].repeat(8),
    title, author: "Course author", committedAt: `2026-10-${16 - index}T12:00:00Z`,
    webUrl: `${projectUrl}/-/commit/${(branch === "develop" ? "def" : "abc")[index].repeat(40)}`,
  }));
}

export function GitlabHistory({ endpoint, branch, projectUrl, demo, selected, onSelect, onAuthRequired }: {
  endpoint: string; branch: string; projectUrl: string; demo: boolean; selected: string | null;
  onSelect: (commit: GitlabCommit) => void; onAuthRequired: () => void;
}) {
  const [commits, setCommits] = useState<GitlabCommit[]>([]);
  const [page, setPage] = useState(1), [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const request = demo ? Promise.resolve({ commits: demoCommits(projectUrl, branch), nextPage: null })
      : gitlabApi<History>(`${endpoint}/commits?${new URLSearchParams({ ref: branch, page: String(page) })}`, controller.signal);
    void request.then((value) => {
      if (controller.signal.aborted) return;
      setCommits((previous) => {
        const items = page === 1 ? [] : previous;
        const seen = new Set(items.map((commit) => commit.id));
        return [...items, ...value.commits.filter((commit) => !seen.has(commit.id))];
      });
      setNextPage(value.nextPage);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setError(error.message || "Could not load history.");
      if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") onAuthRequired();
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, branch, projectUrl, demo, page, retry, onAuthRequired]);
  return <nav className="gitlab-history-pane" aria-label={`Commit history ${branch}`} aria-busy={loading}>
    <ol className="gitlab-history-list">{commits.map((commit, index) => {
      const date = commit.committedAt ? new Date(commit.committedAt) : null;
      const previous = commits[index - 1]?.committedAt;
      const startsDay = index === 0 || date?.toLocaleDateString("en-GB") !== (previous ? new Date(previous).toLocaleDateString("en-GB") : undefined);
      return <li key={commit.id}>
      {startsDay && <div className="gitlab-history-date">{date ? date.toLocaleDateString("en-GB", {
        day: "numeric", month: "long", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
      }) : "No date specified"}</div>}
      <button type="button" className="gitlab-history-commit" aria-current={selected === commit.id ? "true" : undefined}
        title={`${commit.title || "Untitled"}\n${commit.id}`} onClick={() => onSelect(commit)}>
        <GitCommitHorizontal className="gitlab-history-icon" size={15} strokeWidth={1.6} aria-hidden="true" />
        <span className="gitlab-history-entry">
          <span className="gitlab-history-title">{commit.title || "Untitled"}</span>
          <span className="gitlab-history-meta"><span>{commit.author || "Unknown author"}</span>
            {date && <time dateTime={commit.committedAt!} title={date.toLocaleString("en-GB")}>{date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>}
          </span>
        </span>
      </button>
    </li>; })}</ol>
    {loading && <p className="gitlab-history-status" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />Loading history…</p>}
    {error && <div className="gitlab-history-status"><p role="alert">{error}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && (!commits.length ? <p className="gitlab-history-status">No commits in this branch yet.</p>
      : nextPage && <button className="gitlab-load-more" onClick={() => setPage(nextPage)}>Load more commits</button>)}
  </nav>;
}
