import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { GitlabApiError, gitlabApi, type GitlabCommit, type GitlabCommitDetail, type GitlabDiff } from "./gitlab-api";
import { parseGitlabDiff } from "./gitlab-diff";

function FileDiff({ file }: { file: GitlabDiff }) {
  const lines = useMemo(() => parseGitlabDiff(file.diff), [file.diff]);
  const additions = lines.filter((line) => line.kind === "add").length, deletions = lines.filter((line) => line.kind === "remove").length;
  return <details className="gitlab-diff-file" open>
    <summary>
      <span className="gitlab-diff-path">{file.renamedFile ? `${file.oldPath} → ${file.newPath}` : file.deletedFile ? file.oldPath : file.newPath}</span>
      <span className="gitlab-diff-status">{file.newFile ? "Добавлен" : file.deletedFile ? "Удалён" : file.renamedFile ? "Переименован" : "Изменён"}</span>
      {!!(additions || deletions) && <span className="gitlab-diff-count"><span className="gitlab-diff-added">+{additions}</span> <span className="gitlab-diff-removed">−{deletions}</span></span>}
    </summary>
    {file.oldMode && file.newMode && file.oldMode !== file.newMode && <p className="gitlab-diff-note">Права файла: {file.oldMode} → {file.newMode}</p>}
    {file.tooLarge || file.collapsed ? <p className="gitlab-diff-note">GitLab не вернул содержимое диффа этого файла. Открой коммит в GitLab.</p>
      : !file.diff ? <p className="gitlab-diff-note">Нет текстового диффа. Файл бинарный или изменились только имя или права.</p>
        : <div className="gitlab-diff-scroll" tabIndex={0} role="region" aria-label={`Дифф ${file.newPath}`}>
          <table className="gitlab-diff-lines" aria-label="Изменения строк"><thead className="sr-only"><tr><th>Старая строка</th><th>Новая строка</th><th>Изменение</th></tr></thead>
            <tbody>{lines.map((line, index) => <tr key={index} className={`gitlab-diff-${line.kind}`}>
              <td className="gitlab-diff-number">{line.oldLine}</td><td className="gitlab-diff-number">{line.newLine}</td><td><pre>{line.text}</pre></td>
            </tr>)}</tbody>
          </table>
        </div>}
  </details>;
}

export function GitlabCommitViewer({ commit, endpoint, demo, onAuthRequired }: {
  commit: GitlabCommit; endpoint: string; demo: boolean; onAuthRequired: () => void;
}) {
  const [detail, setDetail] = useState<GitlabCommitDetail | null>(null);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const request = demo ? Promise.resolve<GitlabCommitDetail>({ commit: { ...commit, message: commit.title }, nextPage: null,
      diffs: [{ oldPath: "src/index.ts", newPath: "src/index.ts", diff: "@@ -1,3 +1,3 @@\n export function greet(name: string): string {\n-  return `Hello, ${name}!`;\n+  return `Привет, ${name}!`;\n }\n",
        newFile: false, deletedFile: false, renamedFile: false, collapsed: false, tooLarge: false, oldMode: "100644", newMode: "100644" }] })
      : gitlabApi<GitlabCommitDetail>(`${endpoint}/commit?${new URLSearchParams({ sha: commit.id, page: String(page) })}`, controller.signal);
    void request.then((value) => {
      if (controller.signal.aborted) return;
      setDetail((previous) => ({ ...value, diffs: page === 1 || !previous ? value.diffs
        : [...previous.diffs, ...value.diffs.filter((file) => !previous.diffs.some((item) => item.newPath === file.newPath && item.oldPath === file.oldPath))] }));
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setError(error.message || "Не удалось загрузить дифф коммита.");
      if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") onAuthRequired();
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [commit, endpoint, demo, page, retry, onAuthRequired]);
  const current = detail?.commit || commit;
  const message = detail?.commit.message.trim() || "";
  const body = message.split("\n")[0] === current.title ? message.split("\n").slice(1).join("\n").trim() : message;
  return <section className="gitlab-commit-viewer" aria-label="Дифф коммита" aria-busy={loading}>
    <div className="gitlab-commit-diffs">
      {body && <pre className="gitlab-commit-message">{body}</pre>}
      {detail?.diffs.map((file) => <FileDiff key={`${file.oldPath}:${file.newPath}`} file={file} />)}
      {loading && <p className="gitlab-history-status" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />Загружаем изменения…</p>}
      {error && <div className="gitlab-history-status"><p role="alert">{error}</p><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
        <a href={current.webUrl} target="_blank" rel="noopener noreferrer">Открыть в GitLab</a></div>}
      {!loading && !error && detail && (!detail.diffs.length ? <p className="gitlab-history-status">В этом коммите нет изменений файлов.</p>
        : detail.nextPage && <button className="gitlab-load-more" onClick={() => setPage(detail.nextPage!)}>Загрузить ещё файлы</button>)}
    </div>
  </section>;
}
