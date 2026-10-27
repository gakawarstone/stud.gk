export type DiffLine = { kind: "hunk" | "add" | "remove" | "context" | "meta"; text: string; oldLine: number | null; newLine: number | null };

export function parseGitlabDiff(diff: string): DiffLine[] {
  let oldLine = 0, newLine = 0, inHunk = false;
  const lines = diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true;
      return { kind: "hunk", text, oldLine: null, newLine: null };
    }
    if (!inHunk || text.startsWith("\\")) return { kind: "meta", text, oldLine: null, newLine: null };
    if (text.startsWith("+")) return { kind: "add", text, oldLine: null, newLine: newLine++ };
    if (text.startsWith("-")) return { kind: "remove", text, oldLine: oldLine++, newLine: null };
    if (text.startsWith(" ")) return { kind: "context", text, oldLine: oldLine++, newLine: newLine++ };
    return { kind: "meta", text, oldLine: null, newLine: null };
  });
}
