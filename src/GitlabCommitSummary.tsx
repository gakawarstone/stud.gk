import { useEffect, useState } from "react";
import { Check, Copy, History } from "lucide-react";
import type { GitlabCommit } from "./gitlab-api";

function relativeDate(value: string, now: number) {
  const seconds = (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) || ["second", 1];
  return Math.abs(seconds) < 60 ? "just now" : new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
}
export function GitlabCommitSummary({ commit, onOpen, onToggleHistory, historyOpen, historyDisabled, loading }: {
  commit: GitlabCommit | null; onOpen: () => void; onToggleHistory: () => void;
  historyOpen: boolean; historyDisabled: boolean; loading: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const historyButton = <button type="button" className="gitlab-history-toggle" aria-pressed={historyOpen} disabled={historyDisabled} onClick={onToggleHistory}>
    <History size={14} aria-hidden="true" />History
  </button>;
  if (!commit) return <div className="gitlab-commit-bar gitlab-commit-bar-empty">
    <span>{loading ? "Loading commit…" : "Latest commit unavailable"}</span>{historyButton}
  </div>;
  async function copySha() {
    try { await navigator.clipboard.writeText(commit!.id); setCopyStatus("copied"); }
    catch { setCopyStatus("error"); }
  }
  const author = commit.author || "Unknown author";
  const initials = commit.author?.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() || "?";
  const date = commit.committedAt && relativeDate(commit.committedAt, now);
  return <div className="gitlab-commit-bar" aria-label={historyOpen ? "Selected commit" : "Latest commit"}>
    <span className="gitlab-commit-avatar" aria-hidden="true">{initials}</span>
    <div className="gitlab-commit-details">
      <button type="button" className="gitlab-commit-title" onClick={onOpen} title={commit.title || "View commit diff"}>{commit.title || "Untitled"}</button>
      <div className="gitlab-commit-meta"><span className="gitlab-commit-author" title={author}>{author}</span>
        {date && <><span aria-hidden="true">·</span><time dateTime={commit.committedAt!} title={new Date(commit.committedAt!).toLocaleString("en-GB")}>{date}</time></>}
      </div>
    </div>
    <div className="gitlab-commit-actions">
      <div className="gitlab-commit-id">
        <a href={commit.webUrl} className="gitlab-commit-sha" target="_blank" rel="noopener noreferrer" title={`Open commit ${commit.id} in GitLab`}>{commit.shortId}</a>
        <button type="button" className="gitlab-copy-sha" onClick={() => void copySha()} aria-label="Copy commit SHA" title={copyStatus === "copied" ? "Copied" : "Copy SHA"}>
          {copyStatus === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
      </div>
      {historyButton}
      <span className="visually-hidden" role="status">{copyStatus === "copied" ? "SHA copied" : copyStatus === "error" ? "Could not copy SHA" : ""}</span>
    </div>
  </div>;
}
