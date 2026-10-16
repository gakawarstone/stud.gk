export type GitlabCommit = { id: string; shortId: string; title: string; author: string; committedAt: string | null; webUrl: string };
export type GitlabBranch = { name: string; default: boolean; commit: GitlabCommit | null };
export type GitlabEntry = { path: string; name: string; directory: boolean; submodule?: boolean; id?: string };
export type GitlabListing = { branch: string | null; path: string; entries: GitlabEntry[] };
export type GitlabFile = { path: string; content: string | null; binary: boolean; size: number; webUrl: string };
export type GitlabReadme = { branch: string | null; readme: { path: string; content: string; markdown: boolean; webUrl: string } | null };
export class GitlabApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function gitlabApi<T>(endpoint: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(endpoint, { credentials: "same-origin", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new GitlabApiError(data.error || "Не удалось получить данные GitLab.", data.code || "GITLAB_ERROR", response.status);
  return data;
}
export const demoMarkdown = "# Материалы курса\n\nПример репозитория в демо.\n\n```sh\nnpm install\nnpm run dev\n```\n\nИсходный код находится в папке `src`.";
