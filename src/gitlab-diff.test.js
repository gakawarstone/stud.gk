import test from "node:test";
import assert from "node:assert/strict";
import { parseGitlabDiff } from "./gitlab-diff.ts";

test("unified diffs number both sides across hunks and preserve HTML as text", () => {
  const lines = parseGitlabDiff("@@ -8,3 +8,4 @@ function\n context\n-old\n+<img onerror=alert(1)>\n+++literal pluses\n last\n\\ No newline at end of file\n@@ -20 +21 @@\n-a\n+b\n");
  assert.deepEqual(lines.map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine]), [
    ["hunk", null, null], ["context", 8, 8], ["remove", 9, null], ["add", null, 9], ["add", null, 10],
    ["context", 10, 11], ["meta", null, null], ["hunk", null, null], ["remove", 20, null], ["add", null, 21],
  ]);
  assert.equal(lines[3].text, "+<img onerror=alert(1)>");
  assert.equal(lines[4].text, "+++literal pluses");
});

test("diff parsing handles empty, added, removed and binary files", () => {
  assert.deepEqual(parseGitlabDiff(""), []);
  assert.deepEqual(parseGitlabDiff("@@ -0,0 +1,2 @@\n+first\n+\n").slice(1).map((line) => line.newLine), [1, 2]);
  assert.deepEqual(parseGitlabDiff("@@ -1,2 +0,0 @@\n-first\n-\n").slice(1).map((line) => line.oldLine), [1, 2]);
  assert.deepEqual(parseGitlabDiff("Binary files a/image.png and b/image.png differ").map((line) => line.kind), ["meta"]);
});
