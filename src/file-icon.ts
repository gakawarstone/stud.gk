const extensions: Record<string, string> = {
  kt: "kotlin", kts: "kotlin", java: "java", class: "java", jar: "java",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "react", jsx: "react",
  js: "javascript", mjs: "javascript", cjs: "javascript", py: "python", pyw: "python",
  html: "html5", htm: "html5", css: "css3", json: "json", jsonc: "json", json5: "json",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", bat: "bash", cmd: "bash",
  c: "c", h: "c", cc: "cplusplus", cpp: "cplusplus", cxx: "cplusplus", hpp: "cplusplus",
  cs: "csharp", go: "go", rs: "rust", php: "php", rb: "ruby", swift: "swift",
  nix: "nixos", gradle: "gradle", yml: "yaml", yaml: "yaml", vue: "vuejs", svelte: "svelte", dart: "dart",
};
export function fileIcon(name: string): string | null {
  const lower = name.toLowerCase();
  if (/^\.git/.test(lower)) return "git";
  if (/^(build|settings)\.gradle(\.kts)?$/.test(lower) || /^gradle(w(\.bat)?|\.properties)?$/.test(lower)) return "gradle";
  if (lower === "flake.lock") return "nixos";
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (lower === "cargo.lock" || lower === "cargo.toml") return "rust";
  return extensions[lower.split(".").pop() || ""] || null;
}
