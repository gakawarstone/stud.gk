import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import diff from "highlight.js/lib/languages/diff";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";

for (const [name, language] of Object.entries({ javascript, typescript, python, java, kotlin, xml, css, json, yaml, bash, cpp, sql, markdown, go, rust, php, diff, ini, dockerfile }))
  hljs.registerLanguage(name, language);

const extensions: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", java: "java", kt: "kotlin", kts: "kotlin", html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",
  css: "css", scss: "css", json: "json", yaml: "yaml", yml: "yaml", sh: "bash", bash: "bash", zsh: "bash",
  c: "cpp", h: "cpp", cpp: "cpp", hpp: "cpp", cc: "cpp", sql: "sql", md: "markdown", markdown: "markdown",
  go: "go", rs: "rust", php: "php", diff: "diff", patch: "diff", ini: "ini", toml: "ini", conf: "ini",
};
export function highlightCode(content: string, filenameOrLanguage: string) {
  if (content.length > 200_000) return null;
  const name = filenameOrLanguage.toLowerCase();
  const language = name === "dockerfile" ? "dockerfile" : extensions[name.split(".").pop() || ""] || name;
  if (!hljs.getLanguage(language)) return null;
  return hljs.highlight(content, { language, ignoreIllegals: true }).value;
}
