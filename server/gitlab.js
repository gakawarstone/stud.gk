// Shared with the project form; keep this module free of Node-only imports.
export function normalizeGitlabProject(value) {
  const message = "Вставь ссылку на проект GitLab, например https://gitlab.com/group/project.";
  if (typeof value !== "string" || value.length > 2048) throw new Error(message);
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(message);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error(message);
  const parts = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").slice(1);
  if (parts.length < 2 || parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "-" || part === "." || part === ".."))
    throw new Error(message);
  url.pathname = `/${parts.join("/")}`;
  url.search = "";
  url.hash = "";
  return { url: url.href };
}
