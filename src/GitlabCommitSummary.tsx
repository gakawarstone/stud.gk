import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
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
  const [unit, divisor] = units.find(
    ([, size]) => Math.abs(seconds) >= size,
  ) || ["second", 1];
  return Math.abs(seconds) < 60
    ? "только что"
    : new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(
        Math.round(seconds / divisor),
        unit,
      );
}
export function GitlabCommitSummary(props: { commit: GitlabCommit }) {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    onCleanup(() => clearInterval(timer));
  });
  const author = createMemo(() => props.commit.author || "Неизвестный автор");
  const initials = createMemo(
    () =>
      props.commit.author
        ?.trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => Array.from(part)[0])
        .join("")
        .toUpperCase() || "?",
  );
  const date = createMemo(
    () =>
      props.commit.committedAt && relativeDate(props.commit.committedAt, now()),
  );
  return (
    <div class="gitlab-last-commit" aria-label="Последний коммит">
      <span class="gitlab-commit-avatar" aria-hidden="true">
        {initials()}
      </span>
      <div class="gitlab-commit-details">
        <a
          class="gitlab-commit-title"
          href={props.commit.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={props.commit.title}
        >
          {props.commit.title || "Последний коммит"}
        </a>
        <div class="gitlab-commit-meta">
          <span class="gitlab-commit-author" title={author()}>
            {author()}
          </span>
          {date() && (
            <>
              <span aria-hidden="true">·</span>
              <time
                datetime={props.commit.committedAt!}
                title={new Date(props.commit.committedAt!).toLocaleString()}
              >
                {date()}
              </time>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
