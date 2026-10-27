import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { GitlabApiError, gitlabApi, type GitlabCommit, type GitlabHistory as History } from "./gitlab-api";

export function demoCommits(projectUrl: string, branch: string): GitlabCommit[] {
  return ["Обновить материалы курса", "Добавить пример", "Создать репозиторий"].map((title, index) => ({
    id: (branch === "develop" ? "def" : "abc")[index].repeat(40), shortId: (branch === "develop" ? "def" : "abc")[index].repeat(8),
    title, author: "Автор курса", committedAt: `2026-10-${16 - index}T12:00:00Z`,
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
      setError(error.message || "Не удалось загрузить историю.");
      if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") onAuthRequired();
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, branch, projectUrl, demo, page, retry, onAuthRequired]);
  return <nav className="gitlab-history-pane" aria-label={`История коммитов ${branch}`} aria-busy={loading}>
    <ol className="gitlab-history-list">{commits.map((commit) => <li key={commit.id}>
      <button type="button" className="gitlab-history-commit" aria-current={selected === commit.id ? "true" : undefined} onClick={() => onSelect(commit)}>
        <span className="gitlab-history-title">{commit.title || "Без заголовка"}</span>
        <span className="gitlab-commit-meta"><span>{commit.author || "Неизвестный автор"}</span>
          {commit.committedAt && <time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString("ru")}>{new Date(commit.committedAt).toLocaleDateString("ru")}</time>}
        </span>
        <code>{commit.shortId}</code>
      </button>
    </li>)}</ol>
    {loading && <p className="gitlab-history-status" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />Загружаем историю…</p>}
    {error && <div className="gitlab-history-status"><p role="alert">{error}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div>}
    {!loading && !error && (!commits.length ? <p className="gitlab-history-status">В этой ветке пока нет коммитов.</p>
      : nextPage && <button className="gitlab-load-more" onClick={() => setPage(nextPage)}>Загрузить ещё коммиты</button>)}
  </nav>;
}
