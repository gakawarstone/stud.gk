import test from "node:test";
import assert from "node:assert/strict";
import { newsParts } from "./news-text.ts";

test("collapsed news keeps full link targets and excludes offscreen text from focus order", () => {
  const text =
    "x".repeat(410) +
    " https://example.org/path_(test). hidden https://example.org/end";
  const parts = newsParts(text, false);
  assert.equal(parts.map((p) => p.visible).join(""), text.slice(0, 420));
  assert.deepEqual(
    parts.filter((p) => p.url).map((p) => p.url),
    ["https://example.org/path_(test)"],
  );
  assert.equal(
    newsParts(text, true)
      .map((p) => p.visible)
      .join(""),
    text,
  );
  assert.equal(newsParts(text, true).filter((p) => p.url).length, 2);
});
test("news links retain balanced brackets and show trailing punctuation as text", () => {
  const text = "See https://example.org/a_(b)). and https://example.org/[c]!";
  assert.deepEqual(
    newsParts(text, false)
      .filter((p) => p.url)
      .map((p) => p.url),
    ["https://example.org/a_(b)", "https://example.org/[c]"],
  );
});
