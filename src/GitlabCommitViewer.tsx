import { createSignal, createMemo, createEffect, on, onCleanup, For } from "solid-js";
import { LoaderCircle } from "lucide-solid";
import { GitlabApiError, gitlabApi, type GitlabCommit, type GitlabCommitDetail, type GitlabDiff } from "./gitlab-api";
import { parseGitlabDiff } from "./gitlab-diff";
function FileDiff(props: { file: GitlabDiff }) {
  const lines = createMemo(() => parseGitlabDiff(props.file.diff));
  const [highlighted, setHighlighted] = createSignal<{
    lines: ReturnType<typeof lines>;
    oldPath: string;
    newPath: string;
    html: (string | null)[];
  } | null>(null);
  createEffect(
    on(
      () => [
        lines(),
        props.file.diff,
        props.file.oldPath,
        props.file.newPath,
        props.file.tooLarge,
        props.file.collapsed,
      ],
      () => {
        if (!props.file.diff || props.file.tooLarge || props.file.collapsed || props.file.diff.length > 200_000) return;
        let cancelled = false;
        void import("./gitlab-diff-highlight")
          .then(({ highlightGitlabDiff }) => {
            const html = highlightGitlabDiff(lines(), props.file.newPath, props.file.oldPath);
            if (!cancelled)
              setHighlighted({
                lines: lines(),
                oldPath: props.file.oldPath,
                newPath: props.file.newPath,
                html,
              });
          })
          .catch(() => {});
        onCleanup(() => {
          cancelled = true;
        });
      },
    ),
  );
  const html = createMemo(() =>
    highlighted()?.lines === lines() &&
    highlighted()!.oldPath === props.file.oldPath &&
    highlighted()!.newPath === props.file.newPath
      ? highlighted()!.html
      : null,
  );
  const additions = createMemo(() => lines().filter((line) => line.kind === "add").length),
    deletions = createMemo(() => lines().filter((line) => line.kind === "remove").length);
  return (
    <details class="gitlab-diff-file" open>
      <summary>
        <span class="gitlab-diff-path">
          {props.file.renamedFile
            ? `${props.file.oldPath} → ${props.file.newPath}`
            : props.file.deletedFile
              ? props.file.oldPath
              : props.file.newPath}
        </span>
        <span class="gitlab-diff-status">
          {props.file.newFile
            ? "Added"
            : props.file.deletedFile
              ? "Deleted"
              : props.file.renamedFile
                ? "Renamed"
                : "Modified"}
        </span>
        {!!(additions() || deletions()) && (
          <span class="gitlab-diff-count">
            <span class="gitlab-diff-added">+{additions()}</span>{" "}
            <span class="gitlab-diff-removed">−{deletions()}</span>
          </span>
        )}
      </summary>
      {props.file.oldMode && props.file.newMode && props.file.oldMode !== props.file.newMode && (
        <p class="gitlab-diff-note">
          File permissions: {props.file.oldMode} → {props.file.newMode}
        </p>
      )}
      {props.file.tooLarge || props.file.collapsed ? (
        <p class="gitlab-diff-note">GitLab did not return a diff for this file. Open the commit in GitLab.</p>
      ) : !props.file.diff ? (
        <p class="gitlab-diff-note">No text diff. This is a binary file, or only its name or permissions changed.</p>
      ) : (
        <div class="gitlab-diff-scroll" tabindex={0} role="region" aria-label={`Diff ${props.file.newPath}`}>
          <table class="gitlab-diff-lines" aria-label="Line changes">
            <thead class="sr-only">
              <tr>
                <th>Old line</th>
                <th>New line</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {
                <For each={lines()}>
                  {(line, index) => (
                    <tr class={`gitlab-diff-${line.kind}`}>
                      <td class="gitlab-diff-number">{line.oldLine}</td>
                      <td class="gitlab-diff-number">{line.newLine}</td>
                      <td>
                        <pre>
                          {line.kind === "hunk" || line.kind === "meta" ? (
                            line.text
                          ) : (
                            <>
                              <span class="gitlab-diff-sign">{line.text[0]}</span>
                              {html()?.[index()] != null ? (
                                <code class="gitlab-code hljs" innerHTML={html()![index()]!} />
                              ) : (
                                <code class="gitlab-code">{line.text.slice(1)}</code>
                              )}
                            </>
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </For>
              }
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
export function GitlabCommitViewer(props: {
  commit: GitlabCommit;
  endpoint: string;
  demo: boolean;
  onAuthRequired: () => void;
}) {
  const [detail, setDetail] = createSignal<GitlabCommitDetail | null>(null);
  const [page, setPage] = createSignal(1),
    [retry, setRetry] = createSignal(0);
  const [loading, setLoading] = createSignal(true),
    [error, setError] = createSignal<string | null>(null);
  createEffect(
    on(
      () => [props.commit, props.endpoint, props.demo, page(), retry(), props.onAuthRequired],
      () => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        const request = props.demo
          ? Promise.resolve<GitlabCommitDetail>({
              commit: {
                ...props.commit,
                message: props.commit.title,
              },
              nextPage: null,
              diffs: [
                {
                  oldPath: "src/index.ts",
                  newPath: "src/index.ts",
                  diff: "@@ -1,3 +1,3 @@\n export function greet(name: string): string {\n-  return `Hello, ${name}!`;\n+  return `Hi, ${name}!`;\n }\n",
                  newFile: false,
                  deletedFile: false,
                  renamedFile: false,
                  collapsed: false,
                  tooLarge: false,
                  oldMode: "100644",
                  newMode: "100644",
                },
              ],
            })
          : gitlabApi<GitlabCommitDetail>(
              `${props.endpoint}/commit?${new URLSearchParams({
                sha: props.commit.id,
                page: String(page()),
              })}`,
              controller.signal,
            );
        void request
          .then((value) => {
            if (controller.signal.aborted) return;
            setDetail((previous) => ({
              ...value,
              diffs:
                page() === 1 || !previous
                  ? value.diffs
                  : [
                      ...previous.diffs,
                      ...value.diffs.filter(
                        (file) =>
                          !previous.diffs.some(
                            (item) => item.newPath === file.newPath && item.oldPath === file.oldPath,
                          ),
                      ),
                    ],
            }));
          })
          .catch((error) => {
            if (controller.signal.aborted) return;
            setError(error.message || "Could not load the commit diff.");
            if (error instanceof GitlabApiError && error.code === "GITLAB_AUTH_REQUIRED") props.onAuthRequired();
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  const current = createMemo(() => detail()?.commit || props.commit);
  const message = createMemo(() => detail()?.commit.message.trim() || "");
  const body = createMemo(() =>
    message().split("\n")[0] === current().title ? message().split("\n").slice(1).join("\n").trim() : message(),
  );
  return (
    <section class="gitlab-commit-viewer" aria-label="Commit diff" aria-busy={loading()}>
      <div class="gitlab-commit-diffs">
        {body() && <pre class="gitlab-commit-message">{body()}</pre>}
        {detail()?.diffs.map((file) => (
          <FileDiff file={file} />
        ))}
        {loading() && (
          <p class="gitlab-history-status" role="status">
            <LoaderCircle size={14} class="spin" aria-hidden="true" />
            Loading changes…
          </p>
        )}
        {error() && (
          <div class="gitlab-history-status">
            <p role="alert">{error()}</p>
            <button class="text-button" onClick={() => setRetry((value) => value + 1)}>
              Retry
            </button>
            <a href={current().webUrl} target="_blank" rel="noopener noreferrer">
              Open in GitLab
            </a>
          </div>
        )}
        {!loading() &&
          !error() &&
          detail() &&
          (!detail()!.diffs.length ? (
            <p class="gitlab-history-status">No file changes in this commit.</p>
          ) : (
            detail()!.nextPage && (
              <button class="gitlab-load-more" onClick={() => setPage(detail()!.nextPage!)}>
                Load more files
              </button>
            )
          ))}
      </div>
    </section>
  );
}
