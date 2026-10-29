import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudipError } from "./studip.js";
import { normalizeGitlabProject } from "./gitlab.js";
import { GitlabError, validateGitlabToken } from "./gitlab-client.js";
import { previewType } from "./file-preview.js";
import { call } from "./session-calls.js";

/** @param {import('./types.js').RouteState & Required<Pick<import('./types.js').AppOptions,
 * 'getGitlabReadme' | 'getGitlabTree' | 'getGitlabBranches' | 'getGitlabCommits' | 'getGitlabCommit' | 'getGitlabFile' | 'getGitlabContent'>>} options */
export function gitlabRoutes({ state, save, requireLogin, getGitlabReadme, getGitlabTree, getGitlabBranches, getGitlabCommits, getGitlabCommit, getGitlabFile, getGitlabContent }) {
  const router = Router();
  router.post("/courses/:id/gitlab", requireLogin, async (req, res) => {
    const account = state.accounts[req.context.user.id];
    if (!account?.courses.some((course) => course.id === String(req.params.id)))
      throw new StudipError("Course not found in your courses.", 404);
    let project = null;
    if (req.body?.url !== null) {
      try {
        project = normalizeGitlabProject(req.body?.url);
      } catch (error) {
        throw new StudipError(error.message, 400);
      }
    }
    const projects = { ...account.gitlabProjects, [String(req.params.id)]: project };
    if (!project) delete projects[String(req.params.id)];
    account.gitlabProjects = projects;
    await save();
    res.json({ project });
  });
  function linkedGitlab(req) {
    const account = state.accounts[req.context.user.id];
    if (!account?.courses.some((course) => course.id === String(req.params.id)))
      throw new StudipError("Course not found in your courses.", 404);
    const project = Object.hasOwn(account.gitlabProjects ?? {}, String(req.params.id))
      ? account.gitlabProjects[String(req.params.id)] : null;
    if (!project) throw new StudipError("Link a GitLab project to the course first.", 404);
    return new URL(normalizeGitlabProject(project.url).url);
  }
  router.get("/courses/:id/gitlab/readme", requireLogin, async (req, res) => {
    const project = linkedGitlab(req);
    const token = req.session.gitlabTokens?.[project.origin];
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const result = await getGitlabReadme(project.href, {
        token, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (req.context.revoked || req.context.expiresAt <= Date.now())
        throw new StudipError("Your session has expired. Sign in to Stud.IP again.", 401);
      res.json({ ...result, hasToken: Boolean(token) });
    } finally {
      res.off("close", cancel);
    }
  });
  router.get("/courses/:id/gitlab/token", requireLogin, (req, res) => {
    const project = linkedGitlab(req);
    res.json({ connected: Boolean(req.session.gitlabTokens?.[project.origin]) });
  });
  router.post("/courses/:id/gitlab/token", requireLogin, async (req, res) => {
    const project = linkedGitlab(req);
    const token = req.body?.token === null ? null : validateGitlabToken(req.body?.token);
    if (token && project.protocol !== "https:")
      throw new GitlabError("An HTTPS GitLab URL is required to connect a token.", 400);
    const tokens = { ...req.session.gitlabTokens, [project.origin]: token };
    if (!token) delete tokens[project.origin];
    req.session.gitlabTokens = tokens;
    await call(req.session, "save");
    res.json({ connected: Boolean(token) });
  });
  /** @type {[string, (url: string, path: string, options: import('./types.js').GitlabOptions) => Promise<unknown>][]} */
  const readers = [["branches", (url, _path, options) => getGitlabBranches(url, options)],
    ["commits", (url, _path, options) => getGitlabCommits(url, options)], ["commit", getGitlabCommit],
    ["tree", getGitlabTree], ["file", getGitlabFile], ["content", getGitlabContent]];
  for (const [route, read] of readers) {
    router.get(`/courses/:id/gitlab/${route}`, requireLogin, async (req, res) => {
      const project = linkedGitlab(req);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once("close", cancel);
      try {
        const path = (route === "commit" ? req.query.sha : req.query.path) ?? "";
        const ref = req.query.ref;
        const page = req.query.page;
        if (typeof path !== "string" || (ref !== undefined && typeof ref !== "string") || (page !== undefined && typeof page !== "string"))
          throw new GitlabError("Invalid repository path, branch, or page.", 400);
        const result = await read(project.href, path, {
          ref: typeof ref === "string" ? ref : undefined, page: typeof page === "string" ? page : undefined, token: req.session.gitlabTokens?.[project.origin],
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (req.context.revoked || req.context.expiresAt <= Date.now()) {
          if (result instanceof Response) await result.body?.cancel();
          throw new StudipError("Your session has expired. Sign in to Stud.IP again.", 401);
        }
        if (route !== "content") return res.json(result);
        if (!(result instanceof Response)) throw new GitlabError("GitLab returned an invalid file.");
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
