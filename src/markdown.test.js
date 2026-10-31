import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, sourceLink } from "./markdown.ts";

function elements(tree) {
  return (tree.children || []).flatMap((node) => [
    ...(node.type === "element" ? [node] : []),
    ...elements(node),
  ]);
}
test("Markdown preserves GFM and code, discards raw HTML and dangerous URLs", () => {
  const tree = parseMarkdown(
    '# Title\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n- [x] Done\n\n```ts\nconst html = "<script>alert(1)</script>";\n```\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n![unsafe](data:image/svg+xml,bad)',
  );
  const nodes = elements(tree);
  assert.ok(nodes.some((n) => n.tagName === "table"));
  assert.ok(
    nodes.some(
      (n) =>
        n.tagName === "input" && n.properties.checked && n.properties.disabled,
    ),
  );
  assert.ok(
    nodes.some(
      (n) =>
        n.tagName === "code" && n.properties.className.includes("language-ts"),
    ),
  );
  assert.ok(
    !nodes.some((n) => n.tagName === "script" || "onerror" in n.properties),
  );
  assert.ok(
    !nodes.some((n) =>
      String(n.properties.href || n.properties.src || "").match(
        /^(javascript|data):/i,
      ),
    ),
  );
});
test("Markdown links resolve relative paths and reject credentials and executable schemes", () => {
  const base = "https://gitlab.example/group/project/-/blob/main/README.md";
  assert.equal(
    sourceLink("docs/guide.md", base),
    "https://gitlab.example/group/project/-/blob/main/docs/guide.md",
  );
  assert.equal(
    sourceLink("mailto:student@example.org", base),
    "mailto:student@example.org",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "file:///etc/passwd",
    "https://user:pass@example.org",
    "JaVaScRiPt:alert(1)",
    "//user:pass@example.org",
  ])
    assert.equal(sourceLink(url, base), undefined);
});
