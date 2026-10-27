import test from "node:test";
import assert from "node:assert/strict";
import { parseGitlabDiff } from "./gitlab-diff.ts";
import { highlightGitlabDiff } from "./gitlab-diff-highlight.ts";

test("diff highlighting recognizes the file language and escapes executable text", () => {
  const lines = parseGitlabDiff('@@ -1 +1,2 @@\n-const answer = 41;\n+const answer = 42;\n+const html = "<img src=x onerror=alert(1)>";\n');
  const html = highlightGitlabDiff(lines, "src/index.ts");
  assert.equal(html[0], null);
  assert.match(html[1], /hljs-keyword/);
  assert.match(html[2], /hljs-number/);
  assert.match(html[3], /hljs-string/);
  assert.match(html[3], /&lt;img/);
  assert.ok(!html[3].includes("<img"));
  assert.ok(!html[2].startsWith("+"));
});

test("diff highlighting preserves multiline tokens independently on both sides", () => {
  const lines = parseGitlabDiff('@@ -1,3 +1,3 @@\n /* comment\n-old "value"\n+new "value"\n */\n');
  const html = highlightGitlabDiff(lines, "Main.kt");
  for (const value of html.slice(1)) {
    assert.match(value, /^<span class="hljs-comment">/);
    assert.equal((value.match(/<span\b/g) || []).length, (value.match(/<\/span>/g) || []).length);
  }
  assert.match(html[2], /old/);
  assert.match(html[3], /new/);
  const changed = highlightGitlabDiff(parseGitlabDiff('@@ -1,3 +1,2 @@\n-/* old comment\n+val answer = 42\n shared\n-*/\n'), "Main.kt");
  assert.match(changed[1], /hljs-comment/);
  assert.match(changed[2], /hljs-keyword/);
  assert.ok(!changed[3].includes("hljs-comment"), "Old comments must not leak into new-side context");
});

test("separate hunks reset syntax state and renamed files use each side's language", () => {
  const lines = parseGitlabDiff('@@ -1 +1 @@\n-old\n+/* comment\n@@ -10 +10 @@\n-val before = 1\n+val after = 2\n');
  const html = highlightGitlabDiff(lines, "Main.kt");
  assert.match(html[2], /hljs-comment/);
  assert.equal(html[3], null);
  assert.match(html[5], /hljs-keyword/);
  const renamed = highlightGitlabDiff(parseGitlabDiff('@@ -1 +1 @@\n-val old = 1\n+val fresh = 2\n'), "Main.kt", "notes.txt");
  assert.equal(renamed[1], null);
  assert.match(renamed[2], /hljs-keyword/);
});

test("unknown languages and oversized patches fall back to unchanged plain text", () => {
  const lines = parseGitlabDiff('@@ -1 +1 @@\n-old\n+new\n');
  assert.deepEqual(highlightGitlabDiff(lines, "notes.txt"), lines.map(() => null));
  assert.deepEqual(highlightGitlabDiff(parseGitlabDiff("@@ -0,0 +1 @@\n+" + "x".repeat(200001)), "Main.kt"), [null, null]);
  assert.deepEqual(highlightGitlabDiff([], "Main.kt"), []);
});
