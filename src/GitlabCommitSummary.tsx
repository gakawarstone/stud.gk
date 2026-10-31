import { Check, Copy, History, LoaderCircle } from "lucide-solid";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { GitlabCommit } from "./gitlab-api";

function relativeDate(value: string, now: number) {
  const seconds = (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) || ["second", 1];
  return Math.abs(seconds) < 60
    ? "just now"
    : new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
}
export function GitlabCommitSummary(props: {
  commit: GitlabCommit | null;
  onOpen: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
  historyDisabled: boolean;
  loading: boolean;
  onOpenInIdea?: () => void;
  ideaBusy?: boolean;
  ideaPath?: string;
}) {
  const [now, setNow] = createSignal(Date.now());
  const [copyStatus, setCopyStatus] = createSignal<"idle" | "copied" | "error">("idle");
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    onCleanup(() => clearInterval(timer));
  });
  createEffect(
    on(
      () => props.commit?.id,
      () => setCopyStatus("idle"),
    ),
  );
  createEffect(
    on(copyStatus, (status) => {
      if (status === "idle") return;
      const timer = setTimeout(() => setCopyStatus("idle"), 2000);
      onCleanup(() => clearTimeout(timer));
    }),
  );
  const historyButton = () => (
    <button
      type="button"
      class="gitlab-history-toggle"
      aria-pressed={props.historyOpen}
      disabled={props.historyDisabled}
      onClick={() => props.onToggleHistory()}
    >
      <History size={14} aria-hidden="true" />
      History
    </button>
  );
  const ideaButton = () => props.onOpenInIdea && <button type="button" class="gitlab-idea-open"
    onClick={() => props.onOpenInIdea?.()} disabled={props.ideaBusy}
    title={props.ideaPath ? `Open ${props.ideaPath} in IntelliJ IDEA` : "Set up your local project folder"}>
    {props.ideaBusy ? <LoaderCircle size={14} class="spin" aria-hidden="true" /> : <span class="idea-mark" aria-hidden="true">IJ</span>}
    Open in IDEA
  </button>;
  async function copySha() {
    const commit = props.commit;
    if (!commit) return;
    try {
      await navigator.clipboard.writeText(commit.id);
      if (props.commit?.id === commit.id) setCopyStatus("copied");
    } catch {
      if (props.commit?.id === commit.id) setCopyStatus("error");
    }
  }
  return (
    <Show
      when={props.commit}
      keyed
      fallback={
        <div class="gitlab-commit-bar gitlab-commit-bar-empty">
          <span>{props.loading ? "Loading commit…" : "Latest commit unavailable"}</span>
          <div class="gitlab-commit-actions">{historyButton()}{ideaButton()}</div>
        </div>
      }
    >
      {(commit) => {
        const author = () => commit.author || "Unknown author";
        const initials = () =>
          commit.author
            ?.trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => Array.from(part)[0])
            .join("")
            .toUpperCase() || "?";
        const date = createMemo(() => commit.committedAt && relativeDate(commit.committedAt, now()));
        return (
          <div class="gitlab-commit-bar" aria-label={props.historyOpen ? "Selected commit" : "Latest commit"}>
            <span class="gitlab-commit-avatar" aria-hidden="true">
              {initials()}
            </span>
            <div class="gitlab-commit-details">
              <button
                type="button"
                class="gitlab-commit-title"
                onClick={() => props.onOpen()}
                title={commit.title || "View commit diff"}
              >
                {commit.title || "Untitled"}
              </button>
              <div class="gitlab-commit-meta">
                <span class="gitlab-commit-author" title={author()}>
                  {author()}
                </span>
                {date() && (
                  <>
                    <span aria-hidden="true">·</span>
                    <time datetime={commit.committedAt!} title={new Date(commit.committedAt!).toLocaleString("en-GB")}>
                      {date()}
                    </time>
                  </>
                )}
              </div>
            </div>
            <div class="gitlab-commit-actions">
              <div class="gitlab-commit-id">
                <a
                  href={commit.webUrl}
                  class="gitlab-commit-sha"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open commit ${commit.id} in GitLab`}
                >
                  {commit.shortId}
                </a>
                <button
                  type="button"
                  class="gitlab-copy-sha"
                  onClick={() => void copySha()}
                  aria-label="Copy commit SHA"
                  title={copyStatus() === "copied" ? "Copied" : "Copy SHA"}
                >
                  {copyStatus() === "copied" ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Copy size={13} aria-hidden="true" />
                  )}
                </button>
              </div>
              {historyButton()}
              {ideaButton()}
              <span class="visually-hidden" role="status">
                {copyStatus() === "copied" ? "SHA copied" : copyStatus() === "error" ? "Could not copy SHA" : ""}
              </span>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
