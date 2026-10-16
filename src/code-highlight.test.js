import test from "node:test";
import assert from "node:assert/strict";
import { highlightCode } from "./code-highlight.ts";

test("code previews highlight known languages and escape executable source", () => {
  const html = highlightCode('export const value: string = "<img src=x onerror=alert(1)>";', "index.ts");
  assert.match(html, /hljs-keyword/);
  assert.match(html, /hljs-string/);
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
  assert.match(highlightCode('def greet():\n    return "hello"', "main.py"), /hljs-keyword/);
  assert.match(highlightCode('const x = 1;', "javascript"), /hljs-number/);
  assert.equal(highlightCode("plain text", "notes.txt"), null);
  assert.equal(highlightCode("x".repeat(200001), "large.ts"), null);
});
