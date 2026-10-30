import { createSignal, createMemo, createEffect, on, onCleanup, For } from "solid-js";
import { GitCommitHorizontal, LoaderCircle } from "lucide-solid";
import { GitlabApiError, gitlabApi, type GitlabCommit, type GitlabHistory as History } from "./gitlab-api";
export function demoCommits(projectUrl: string, branch: string): GitlabCommit[] {
  return ["Update course materials", "Add example", "Create repository"].map((title, index) => ({
    id: (branch === "develop" ? "def" : "abc")[index].repeat(40),
    shortId: (branch === "develop" ? "def" : "abc")[index].repeat(8),
    title,
    author: "Course author",
    committedAt: `2026-10-${16 - index}T12:00:00Z`,
    webUrl: `${projectUrl}/-/commit/${(branch === "develop" ? "def" : "abc")[index].repeat(40)}`,
  }));
}
export function GitlabHistory(props: {
  endpoint: string;
  branch: string;
  projectUrl: string;
  demo: boolean;
  selected: string | null;
  onSelect: (commit: GitlabCommit) => void;
  onAuthRequired: () => void;
}) {
  const [commits, setCommits] = createSignal<GitlabCommit[]>([]);
  const [page, setPage] = createSignal(1),
    [nextPage, setNextPage] = createSignal<number | null>(null);
  const [loading, setLoading] = createSignal(true),
    [error, setError] = createSignal<string | null>(null),
    [retry, setRetry] = createSignal(0);
  createEffect(
    on(
      () => [props.endpoint, props.branch, props.projectUrl, props.demo, page(), retry(), props.onAuthRequired],
      () => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        const request = props.demo
          ? Promise.resolve({
              commits: demoCommits(props.projectUrl, props.branch),
              nextPage: null,
            })
          : gitlabApi<History>(
              `${props.endpoint}/commits?${new URLSearchParams({
                ref: props.branch,
                page: String(page()),
              })}`,
              controller.signal,
            );
        void request
          .then((value) => {
            if (controller.signal.aborted) return;
            setCommits((previous) => {
              const items = page() === 1 ? [] : previous;
              const seen = new Set(items.map((commit) => commit.id));
              return [...items, ...value.commits.filter((commit) => !seen.has(commit.id))];
            });
            setNextPage(value.nextPage);
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setError(error.message || "Could not load history.");
            if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") props.onAuthRequired();
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  return (
    <nav class="gitlab-history-pane" aria-label={`Commit history ${props.branch}`} aria-busy={loading()}>
      <ol class="gitlab-history-list">
        {
          <For each={commits()}>
            {(commit, index) => {
              const date = commit.committedAt ? new Date(commit.committedAt) : null;
              const previous = createMemo(() => commits()[index() - 1]?.committedAt);
              const startsDay = createMemo(
                () =>
                  index() === 0 ||
                  date?.toLocaleDateString("en-GB") !==
                    (previous() ? new Date(previous()!).toLocaleDateString("en-GB") : undefined),
              );
              return (
                <li>
                  {startsDay() && (
                    <div class="gitlab-history-date">
                      {date
                        ? date.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                            ...(date.getFullYear() !== new Date().getFullYear()
                              ? {
                                  year: "numeric",
                                }
                              : {}),
                          })
                        : "No date specified"}
                    </div>
                  )}
                  <button
                    type="button"
                    class="gitlab-history-commit"
                    aria-current={props.selected === commit.id ? "true" : undefined}
                    title={`${commit.title || "Untitled"}\n${commit.id}`}
                    onClick={() => props.onSelect(commit)}
                  >
                    <GitCommitHorizontal class="gitlab-history-icon" size={15} stroke-width={1.6} aria-hidden="true" />
                    <span class="gitlab-history-entry">
                      <span class="gitlab-history-title">{commit.title || "Untitled"}</span>
                      <span class="gitlab-history-meta">
                        <span>{commit.author || "Unknown author"}</span>
                        {date && (
                          <time datetime={commit.committedAt!} title={date.toLocaleString("en-GB")}>
                            {date.toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            }}
          </For>
        }
      </ol>
      {loading() && (
        <p class="gitlab-history-status" role="status">
          <LoaderCircle size={14} class="spin" aria-hidden="true" />
          Loading history…
        </p>
      )}
      {error() && (
        <div class="gitlab-history-status">
          <p role="alert">{error()}</p>
          <button class="text-button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}
      {!loading() &&
        !error() &&
        (!commits().length ? (
          <p class="gitlab-history-status">No commits in this branch yet.</p>
        ) : (
          nextPage() && (
            <button class="gitlab-load-more" onClick={() => setPage(nextPage()!)}>
              Load more commits
            </button>
          )
        ))}
    </nav>
  );
}
