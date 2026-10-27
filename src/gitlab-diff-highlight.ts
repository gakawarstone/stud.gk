import { highlightCode } from "./code-highlight.ts";
import type { DiffLine } from "./gitlab-diff.ts";

// Keep token spans balanced when a comment or string crosses a line boundary.
function highlightedLines(html: string): string[] {
  const result: string[] = [], spans: string[] = [];
  let current = "", offset = 0;
  for (const match of html.matchAll(/<span\b[^>]*>|<\/span>|\n/g)) {
    current += html.slice(offset, match.index);
    const token = match[0];
    if (token === "\n") {
      result.push(current + "</span>".repeat(spans.length));
      current = spans.join("");
    } else {
      if (token === "</span>") spans.pop(); else spans.push(token);
      current += token;
    }
    offset = match.index! + token.length;
  }
  result.push(current + html.slice(offset));
  return result;
}

export function highlightGitlabDiff(lines: DiffLine[], newPath: string, oldPath = newPath): (string | null)[] {
  const result: (string | null)[] = lines.map(() => null);
  if (lines.reduce((size, line) => size + line.text.length + 1, 0) > 200_000) return result;
  let hunk: { line: DiffLine; index: number }[] = [];
  function flush() {
    if (!hunk.length) return;
    const oldSource = hunk.filter(({ line }) => line.kind !== "add").map(({ line }) => line.text.slice(1)).join("\n");
    const newSource = hunk.filter(({ line }) => line.kind !== "remove").map(({ line }) => line.text.slice(1)).join("\n");
    const oldHtml = highlightCode(oldSource, oldPath), newHtml = highlightCode(newSource, newPath);
    const oldLines = oldHtml === null ? [] : highlightedLines(oldHtml), newLines = newHtml === null ? [] : highlightedLines(newHtml);
    let oldIndex = 0, newIndex = 0;
    for (const { line, index } of hunk) {
      if (line.kind === "remove") result[index] = oldLines[oldIndex++] ?? null;
      else if (line.kind === "add") result[index] = newLines[newIndex++] ?? null;
      else { result[index] = newLines[newIndex++] ?? null; oldIndex++; }
    }
    hunk = [];
  }
  lines.forEach((line, index) => {
    if (line.kind === "hunk") flush();
    else if (["add", "remove", "context"].includes(line.kind)) hunk.push({ line, index });
  });
  flush();
  return result;
}
