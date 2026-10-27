import { normalizeGitlabProject } from "./gitlab.js";
import { publicRequest } from "./public-http.js";

export class GitlabError extends Error {
  constructor(message, status = 502, code = "GITLAB_ERROR") {
    super(message); this.status = status; this.code = code;
  }
}
export function validateGitlabToken(token) {
  if (typeof token !== "string" || !/^[\x21-\x7e]{1,512}$/.test(token))
    throw new GitlabError("Вставь токен доступа GitLab без пробелов.", 400);
  return token;
}
export function repositoryPath(value = "") {
  if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value)
    || (value && value.split("/").some((part) => !part || part === "." || part === "..")))
    throw new GitlabError("Некорректный путь в репозитории.", 400);
  return value;
}
function repositoryRef(value) {
  if (value !== undefined && (typeof value !== "string" || !value || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)))
    throw new GitlabError("Некорректная ветка репозитория.", 400);
  return value;
}
function repositoryPage(value = 1) {
  if (!/^[1-9]\d{0,5}$/.test(String(value)) || !["string", "number"].includes(typeof value))
    throw new GitlabError("Некорректная страница истории.", 400);
  return Number(value);
}
function commitId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{7,64}$/i.test(value))
    throw new GitlabError("Некорректный идентификатор коммита.", 400);
  return value;
}
function normalizeCommit(commit, project) {
  if (!commit || typeof commit.id !== "string" || !/^[a-f0-9]{7,64}$/i.test(commit.id)) return null;
  return { id: commit.id, shortId: commit.id.slice(0, 8),
    title: typeof commit.title === "string" ? commit.title : "",
    author: typeof commit.author_name === "string" ? commit.author_name : "",
    committedAt: typeof commit.committed_date === "string" && Number.isFinite(Date.parse(commit.committed_date)) ? commit.committed_date : null,
    webUrl: `${project.href}/-/commit/${encodeURIComponent(commit.id)}` };
}
function nextPage(headers, page, length, perPage) {
  const next = headers.get("x-next-page");
  if (next === "" || (next === null && length < perPage)) return null;
  if (next !== null && next !== String(page + 1)) throw new GitlabError("GitLab вернул некорректную страницу истории.");
  return page + 1;
}
async function readBody(response, limit = 2 * 1024 * 1024, tooLarge = "Файл слишком большой для просмотра. Его можно скачать.") {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let length = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      length += value.byteLength;
      if (length > limit) throw new GitlabError(tooLarge, 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
}
export function createGitlabClient(request = publicRequest) {
  function connection(value, { token, signal = AbortSignal.timeout(20000) } = {}) {
    const project = new URL(normalizeGitlabProject(value).url);
    if (token) {
      validateGitlabToken(token);
      if (project.protocol !== "https:") throw new GitlabError("Для подключения токена нужна ссылка GitLab с HTTPS.", 400);
    }
    const api = `${project.origin}/api/v4/projects/${encodeURIComponent(project.pathname.slice(1))}`;
    async function get(url, json = false, projectRequest = false) {
      let response;
      try {
        response = await request(new URL(url), { headers: { Accept: json ? "application/json" : "*/*",
          "Accept-Encoding": "identity", ...(token ? { "PRIVATE-TOKEN": token } : {}) }, signal });
      } catch { throw new GitlabError("Не удалось загрузить данные GitLab. Проверь соединение и попробуй ещё раз."); }
      if (response.status !== 200) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status) || (projectRequest && response.status === 404))
          throw new GitlabError(token ? "Нет доступа к проекту. Проверь адрес и права токена GitLab."
            : "Проект закрыт или не найден. Для закрытого проекта подключи токен GitLab.", 403, token ? "GITLAB_ACCESS_DENIED" : "GITLAB_AUTH_REQUIRED");
        if (response.status === 404) throw new GitlabError("Файл, папка или коммит не найдены в репозитории.", 404);
        if (response.status === 429) throw new GitlabError("GitLab ограничил частоту запросов. Попробуй немного позже.", 429);
        throw new GitlabError("Не удалось получить данные GitLab. Попробуй ещё раз.");
      }
      if (json && !response.headers.get("content-type")?.includes("application/json")) {
        await response.body?.cancel(); throw new GitlabError("GitLab не вернул данные проекта. Проверь адрес сервера.");
      }
      return response;
    }
    async function json(url, projectRequest = false) {
      const response = await get(url, true, projectRequest);
      try { return { data: JSON.parse((await readBody(response, 2 * 1024 * 1024, "Ответ GitLab слишком большой для просмотра. Открой проект в GitLab.")).toString("utf8")), headers: response.headers }; }
      catch (error) { if (error instanceof GitlabError) throw error; throw new GitlabError("GitLab вернул некорректные данные."); }
    }
    const rawUrl = (path, ref) => `${api}/repository/files/${encodeURIComponent(path)}/raw?${new URLSearchParams({ ref: ref || "HEAD" })}`;
    const webUrl = (path, ref, kind = "blob") => `${project.href}/-/${kind}/${(ref || "HEAD").split("/").map(encodeURIComponent).join("/")}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return { project, api, get, json, rawUrl, webUrl };
  }
  return {
    async branches(value, options = {}) {
      const c = connection(value, options);
      const branches = [], seen = new Set();
      for (let page = 1; page <= 50; page++) {
        const { data, headers } = await c.json(`${c.api}/repository/branches?${new URLSearchParams({ per_page: "100", page: String(page) })}`, true);
        if (!Array.isArray(data)) throw new GitlabError("GitLab вернул некорректный список веток.");
        for (const item of data) {
          if (!item || typeof item.name !== "string") continue;
          repositoryRef(item.name);
          if (seen.has(item.name)) continue;
          seen.add(item.name);
          branches.push({ name: item.name, default: item.default === true,
            commit: normalizeCommit(item.commit, c.project) });
        }
        const next = headers.get("x-next-page");
        if (next === "" || (!next && data.length < 100)) break;
        if (next && next !== String(page + 1)) throw new GitlabError("GitLab вернул некорректную страницу веток.");
        if (page === 50) throw new GitlabError("В репозитории слишком много веток. Открой список в GitLab.", 413);
      }
      return { branches };
    },
    async commits(value, options = {}) {
      repositoryRef(options.ref);
      const page = repositoryPage(options.page), perPage = 30;
      const c = connection(value, options);
      const query = new URLSearchParams({ ref_name: options.ref || "HEAD", page: String(page), per_page: String(perPage) });
      const { data, headers } = await c.json(`${c.api}/repository/commits?${query}`, true);
      if (!Array.isArray(data)) throw new GitlabError("GitLab вернул некорректную историю коммитов.");
      const commits = data.map((item) => normalizeCommit(item, c.project));
      if (commits.some((item) => !item)) throw new GitlabError("GitLab вернул некорректный коммит.");
      return { commits, nextPage: nextPage(headers, page, data.length, perPage) };
    },
    async commit(value, sha, options = {}) {
      commitId(sha);
      const page = repositoryPage(options.page), perPage = 20;
      const c = connection(value, options);
      const url = `${c.api}/repository/commits/${encodeURIComponent(sha)}`;
      const { data: metadata } = await c.json(url);
      const commit = normalizeCommit(metadata, c.project);
      if (!commit || !commit.id.toLowerCase().startsWith(sha.toLowerCase())) throw new GitlabError("GitLab вернул некорректный коммит.");
      const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      const { data, headers } = await c.json(`${c.api}/repository/commits/${encodeURIComponent(commit.id)}/diff?${query}`);
      if (!Array.isArray(data)) throw new GitlabError("GitLab вернул некорректный дифф коммита.");
      const diffs = data.map((item) => {
        if (!item || typeof item.old_path !== "string" || typeof item.new_path !== "string")
          throw new GitlabError("GitLab вернул некорректный файл диффа.");
        return { oldPath: item.old_path, newPath: item.new_path, diff: typeof item.diff === "string" ? item.diff : "",
          newFile: item.new_file === true, deletedFile: item.deleted_file === true, renamedFile: item.renamed_file === true,
          collapsed: item.collapsed === true, tooLarge: item.too_large === true,
          oldMode: typeof item.a_mode === "string" ? item.a_mode : null, newMode: typeof item.b_mode === "string" ? item.b_mode : null };
      });
      return { commit: { ...commit, message: typeof metadata.message === "string" ? metadata.message : commit.title },
        diffs, nextPage: nextPage(headers, page, data.length, perPage) };
    },
    async list(value, path = "", options = {}) {
      repositoryPath(path); repositoryRef(options.ref);
      const c = connection(value, options);
      const { data: metadata } = await c.json(c.api, true);
      const branch = metadata.default_branch;
      if (!branch) return { branch: null, path, entries: [] };
      repositoryRef(branch);
      const ref = options.ref || branch;
      const entries = [], seen = new Set();
      for (let page = 1; page <= 50; page++) {
        const { data, headers } = await c.json(`${c.api}/repository/tree?${new URLSearchParams({ path, ref, per_page: "100", page: String(page) })}`);
        if (!Array.isArray(data)) throw new GitlabError("GitLab вернул некорректный список файлов.");
        for (const entry of data) {
          if (!entry || !["tree", "blob", "commit"].includes(entry.type)) continue;
          const filePath = repositoryPath(entry.path);
          if (!filePath || filePath.split("/").slice(0, -1).join("/") !== path || seen.has(filePath)) continue;
          seen.add(filePath);
          entries.push({ path: filePath, name: filePath.split("/").pop(), directory: entry.type === "tree", submodule: entry.type === "commit", id: entry.id });
        }
        const next = headers.get("x-next-page");
        if (next === "" || (!next && data.length < 100)) break;
        if (next && next !== String(page + 1)) throw new GitlabError("GitLab вернул некорректную страницу файлов.");
        if (page === 50) throw new GitlabError("В папке слишком много файлов. Открой нужную подпапку в GitLab.", 413);
      }
      entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { branch: ref, path, entries };
    },
    async file(value, path, options = {}) {
      if (!repositoryPath(path)) throw new GitlabError("Укажи файл репозитория.", 400);
      repositoryRef(options.ref);
      const c = connection(value, options);
      const buffer = await readBody(await c.get(c.rawUrl(path, options.ref)));
      let content = null;
      try { if (!buffer.includes(0)) content = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { /* Binary files use the download or media viewer. */ }
      return { path, content, binary: content === null, size: buffer.length, webUrl: c.webUrl(path, options.ref) };
    },
    async content(value, path, options = {}) {
      if (!repositoryPath(path)) throw new GitlabError("Укажи файл репозитория.", 400);
      repositoryRef(options.ref);
      const c = connection(value, options);
      return c.get(c.rawUrl(path, options.ref));
    },
    async readme(value, options = {}) {
      const c = connection(value, options);
      const { data: metadata } = await c.json(c.api, true);
      const branch = metadata.default_branch;
      if (!branch || !metadata.readme_url) return { branch: branch || null, readme: null };
      repositoryRef(branch);
      try {
        const source = new URL(metadata.readme_url);
        if (source.origin !== c.project.origin) throw new Error("Invalid README origin");
        const pathname = decodeURIComponent(source.pathname);
        const prefix = [`${c.project.pathname}/-/blob/${branch}/`, `${c.project.pathname}/blob/${branch}/`].find((value) => pathname.startsWith(value));
        if (!prefix) throw new Error("Invalid README path");
        const path = repositoryPath(pathname.slice(prefix.length));
        if (!path) throw new Error("Invalid README path");
        const content = (await readBody(await c.get(c.rawUrl(path, branch)), 1024 * 1024)).toString("utf8");
        return { branch, readme: { path, content, webUrl: c.webUrl(path, branch), markdown: /\.(md|markdown|mdown|mkd)$/i.test(path) } };
      } catch (error) {
        if (error instanceof GitlabError) throw error;
        throw new GitlabError("Не удалось загрузить README. Проверь адрес GitLab.");
      }
    },
  };
}
