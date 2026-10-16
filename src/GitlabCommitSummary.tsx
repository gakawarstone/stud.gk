import { useEffect, useState } from "react";
import type { GitlabCommit } from "./gitlab-api";

function relativeDate(value: string, now: number) {
  const seconds = (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) || ["second", 1];
  return Math.abs(seconds) < 60 ? "только что" : new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
}
export function GitlabCommitSummary({ commit }: { commit: GitlabCommit }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const author = commit.author || "Неизвестный автор";
  const initials = commit.author?.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() || "?";
  const date = commit.committedAt && relativeDate(commit.committedAt, now);
  return <div className="gitlab-last-commit" aria-label="Последний коммит">
    <span className="gitlab-commit-avatar" aria-hidden="true">{initials}</span>
    <div className="gitlab-commit-details">
    <a className="gitlab-commit-title" href={commit.webUrl} target="_blank" rel="noopener noreferrer" title={commit.title}>{commit.title || "Последний коммит"}</a>
    <div className="gitlab-commit-meta"><span className="gitlab-commit-author" title={author}>{author}</span>
      {date && <><span aria-hidden="true">·</span><time dateTime={commit.committedAt!} title={new Date(commit.committedAt!).toLocaleString()}>{date}</time></>}
    </div>
    </div>
  </div>;
}
