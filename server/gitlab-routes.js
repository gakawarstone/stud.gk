import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudipError } from "./studip.js";
import { normalizeGitlabProject } from "./gitlab.js";
import { GitlabError, validateGitlabToken } from "./gitlab-client.js";
import { previewType } from "./file-preview.js";

/** @param {import('./types.js').RouteState & Required<Pick<import('./types.js').AppOptions,
 * 'getGitlabReadme' | 'getGitlabTree' | 'getGitlabBranches' | 'getGitlabCommits' | 'getGitlabCommit' | 'getGitlabFile' | 'getGitlabContent'>> & {
 * gitlabTokens: Awaited<ReturnType<typeof import('./gitlab-tokens.js').openGitlabTokens>>
 * }} options */
export function gitlabRoutes({ state, save, requireLogin, gitlabTokens, getGitlabReadme, getGitlabTree, getGitlabBranches, getGitlabCommits, getGitlabCommit, getGitlabFile, getGitlabContent }) {
  const router = Router();
  function courseAccount(req) {
    const account = state.accounts[req.context.user.id];
    if (!account?.courses.some((course) => course.id === String(req.params.id)))
      throw new StudipError("Курс не найден в твоих курсах.", 404);
    return account;
  }
  const projectRoute = "/courses/:id/gitlab/projects/:projectId";
  // Keep the old endpoint working for clients that only know the first project.
  async function saveProject(req, res, adding = false) {
    const account = courseAccount(req);
    const courseId = String(req.params.id);
    const current = Object.hasOwn(account.gitlabProjects ?? {}, courseId) ? account.gitlabProjects[courseId] : [];
    const id = req.params.projectId ? String(req.params.projectId) : adding ? undefined : current[0]?.id;
    if (id && !current.some((project) => project.id === id))
      throw new StudipError("Проект GitLab не найден в этом курсе.", 404);
    let project = null;
    if (req.body?.url !== null) {
      try {
        project = { id: id ?? randomUUID(), ...normalizeGitlabProject(req.body?.url) };
      } catch (error) {
        throw new StudipError(error.message, 400);
      }
      if (current.some((item) => item.id !== id && item.url === project.url))
        throw new StudipError("Этот проект GitLab уже добавлен к курсу.", 409);
    } else if (adding) throw new StudipError("Укажи ссылку на проект GitLab.", 400);
    const projects = id ? current.flatMap((item) => item.id === id ? project ? [project] : [] : [item])
      : project ? [...current, project] : current;
    account.gitlabProjects = { ...account.gitlabProjects, [courseId]: projects };
    if (!projects.length) delete account.gitlabProjects[courseId];
    await save();
    res.json({ project, projects });
  }
  router.post("/courses/:id/gitlab/projects", requireLogin, (req, res) => saveProject(req, res, true));
  router.post(["/courses/:id/gitlab", projectRoute], requireLogin, (req, res) => saveProject(req, res));
  function linkedGitlab(req) {
    const account = courseAccount(req);
    const courseId = String(req.params.id);
    const projects = Object.hasOwn(account.gitlabProjects ?? {}, courseId) ? account.gitlabProjects[courseId] : [];
    const project = req.params.projectId ? projects.find((item) => item.id === req.params.projectId) : projects[0];
    if (!project) throw new StudipError("Проект GitLab не найден в этом курсе.", 404);
    return new URL(normalizeGitlabProject(project.url).url);
  }
  router.get(["/courses/:id/gitlab/readme", `${projectRoute}/readme`], requireLogin, async (req, res) => {
    const project = linkedGitlab(req);
    const token = gitlabTokens.get(req.context.user.id, project.origin);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const result = await getGitlabReadme(project.href, {
        token, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (req.context.revoked || req.context.expiresAt <= Date.now())
        throw new StudipError("Сессия истекла. Войди в Stud.IP заново.", 401);
      res.json({ ...result, hasToken: Boolean(token) });
    } finally {
      res.off("close", cancel);
    }
  });
  router.get(["/courses/:id/gitlab/token", `${projectRoute}/token`], requireLogin, (req, res) => {
    const project = linkedGitlab(req);
    res.json({ connected: Boolean(gitlabTokens.get(req.context.user.id, project.origin)) });
  });
  router.post(["/courses/:id/gitlab/token", `${projectRoute}/token`], requireLogin, async (req, res) => {
    const project = linkedGitlab(req);
    const token = req.body?.token === null ? null : validateGitlabToken(req.body?.token);
    if (token && project.protocol !== "https:")
      throw new GitlabError("Для подключения токена нужна ссылка GitLab с HTTPS.", 400);
    await gitlabTokens.set(req.context.user.id, project.origin, token);
    res.json({ connected: Boolean(token) });
  });
  /** @type {[string, (url: string, path: string, options: import('./types.js').GitlabOptions) => Promise<unknown>][]} */
  const readers = [["branches", (url, _path, options) => getGitlabBranches(url, options)],
    ["commits", (url, _path, options) => getGitlabCommits(url, options)], ["commit", getGitlabCommit],
    ["tree", getGitlabTree], ["file", getGitlabFile], ["content", getGitlabContent]];
  for (const [route, read] of readers) {
    router.get([`/courses/:id/gitlab/${route}`, `${projectRoute}/${route}`], requireLogin, async (req, res) => {
      const project = linkedGitlab(req);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once("close", cancel);
      try {
        const path = (route === "commit" ? req.query.sha : req.query.path) ?? "";
        const ref = req.query.ref;
        const page = req.query.page;
        if (typeof path !== "string" || (ref !== undefined && typeof ref !== "string") || (page !== undefined && typeof page !== "string"))
          throw new GitlabError("Некорректный путь, ветка или страница репозитория.", 400);
        const result = await read(project.href, path, {
          ref: typeof ref === "string" ? ref : undefined, page: typeof page === "string" ? page : undefined, token: gitlabTokens.get(req.context.user.id, project.origin),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (req.context.revoked || req.context.expiresAt <= Date.now()) {
          if (result instanceof Response) await result.body?.cancel();
          throw new StudipError("Сессия истекла. Войди в Stud.IP заново.", 401);
        }
        if (route !== "content") return res.json(result);
        if (!(result instanceof Response)) throw new GitlabError("GitLab вернул некорректный файл.");
        const filename = path.split("/").pop();
        const download = req.query.download === "1";
        const mediaTypes = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
          webp: "image/webp", avif: "image/avif", bmp: "image/bmp", mp4: "video/mp4", webm: "video/webm",
          mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
        const mime = mediaTypes[filename.split(".").pop().toLowerCase()];
        res.attachment(filename).type(download ? "application/octet-stream" : previewType({ title: filename, mime }, result) || "application/octet-stream");
        if (!download) res.set("Content-Disposition", res.get("Content-Disposition").replace(/^attachment/, "inline"));
        await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (result.body)), res, { signal: controller.signal });
      } catch (error) {
        if (!res.headersSent && !controller.signal.aborted) throw error;
        if (!res.destroyed) res.destroy();
      } finally { res.off("close", cancel); }
    });
  }
  return router;
}
