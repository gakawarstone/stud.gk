import path from "node:path";
import express from "express";
import session from "express-session";
import { CookieJar } from "tough-cookie";
import { BASE, createClient, fetchSnapshot, fetchCourseFolders, StudipError } from "./studip.js";
import { loginStudip } from "./login.js";
import {
  EncryptedSessionStore,
  SESSION_NAME,
  SESSION_LIFETIME,
} from "./sessions.js";
import { reconcile } from "./changes.js";
import { createGitlabClient, GitlabError } from "./gitlab-client.js";
import { createDemoFolders } from "./demo.js";
import { nextcloudRoutes } from "./nextcloud-routes.js";
import { createFileCache } from "./file-cache.js";

import { authRoutes } from "./auth-routes.js";
import { gitlabRoutes } from "./gitlab-routes.js";
import { openGitlabTokens } from "./gitlab-tokens.js";
import { fileRoutes } from "./file-routes.js";
import { openAccountState } from "./account-state.js";
import { call } from "./session-calls.js";

/** @returns {import('../shared/studip.js').AccountState} */
const empty = () => ({
  courses: [],
  resources: [],
  changes: [],
  lastSync: null,
  semester: "",
});

/** @param {import('./types.js').AppOptions} options */
export async function createApp({
  dataDir,
  authenticate = loginStudip,
  getSnapshot = fetchSnapshot,
  getFolders = fetchCourseFolders,
  getDownload = (client, file, options) => client.download(file, options),
  getGitlabReadme = createGitlabClient().readme,
  getGitlabTree = createGitlabClient().list,
  getGitlabBranches = createGitlabClient().branches,
  getGitlabCommits = createGitlabClient().commits,
  getGitlabCommit = createGitlabClient().commit,
  getGitlabFile = createGitlabClient().file,
  getGitlabContent = createGitlabClient().content,
  nextcloudClient,
  autoSync = true,
  sessionName = SESSION_NAME,
  fileCacheBytes,
}) {
  const accountState = await openAccountState(dataDir);
  const { state, save } = accountState;
  const store = await EncryptedSessionStore.open(dataDir);
  const gitlabTokens = await openGitlabTokens(dataDir, store);
  const fileCache = await createFileCache(path.join(dataDir, "files"), { maxBytes: fileCacheBytes });
  /** @param {import('../shared/studip.js').AccountState} account */
  const accessibleFiles = (account) => account.resources.filter((file) =>
    !(account.unavailableSources ?? []).some((source) =>
      source.kind === "file" && source.courseId === file.courseId));
  for (const [id, account] of Object.entries(state.accounts))
    await fileCache.prune(id, accessibleFiles(account));
  /** @type {Map<string, import('./types.js').Context>} */
  const contexts = new Map();
  const statuses = new Map();
  /** @param {string} id @param {import('./types.js').Auth} auth */
  function contextFor(id, auth) {
    if (!auth?.user || auth.expiresAt <= Date.now()) return null;
    let context = contexts.get(id);
    if (!context) {
      const jar = CookieJar.fromJSON(auth.jar);
      context = {
        sessionId: id,
        user: auth.user,
        jar,
        client: createClient(jar),
        expiresAt: auth.expiresAt,
        revoked: false,
      };
      contexts.set(id, context);
    }
    return context;
  }
  /** @param {import('./types.js').Context} context */
  function statusFor(context) {
    if (!statuses.has(context.user.id))
      statuses.set(context.user.id, {
        syncing: false,
        error: null,
        lastAttempt: 0,
      });
    return statuses.get(context.user.id);
  }
  /** @param {import('./types.js').Context} context */
  async function expire(context) {
    context.revoked = true;
    contexts.delete(context.sessionId);
    await call(store, "destroy", context.sessionId);
  }
  /** @param {import('./types.js').Context} context */
  async function sync(context) {
    const status = statusFor(context);
    if (context.revoked || context.expiresAt <= Date.now())
      throw new StudipError("Войди в Stud.IP заново.", 401);
    if (status.syncing)
      throw new StudipError("Обновление уже выполняется.", 409);
    status.syncing = true;
    status.lastAttempt = Date.now();
    try {
      const snapshot = await getSnapshot(context.client, context.user);
      if (context.revoked) return;
      const previous = state.accounts[context.user.id];
      state.accounts[context.user.id] = {
        ...reconcile(previous, snapshot),
        gitlabProjects: previous?.gitlabProjects ?? {},
      };
      await fileCache.prune(context.user.id, accessibleFiles(state.accounts[context.user.id]));
      await save();
      const saved = await call(store, "get", context.sessionId);
      if (saved?.auth && !context.revoked) {
        saved.auth.jar = context.jar.toJSON();
        await call(store, "set", context.sessionId, saved);
      }
      status.error = null;
    } catch (error) {
      status.error =
        error instanceof StudipError
          ? error.message
          : "Не удалось обновить курсы. Предыдущие данные сохранены.";
      if (error.status === 401) await expire(context);
      throw error;
    } finally {
      status.syncing = false;
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") {
      let originHost;
      try {
        originHost = req.headers.origin
          ? new URL(req.headers.origin).host
          : null;
      } catch {
        return res
          .status(403)
          .json({ error: "Недопустимый источник запроса." });
      }
      if (
        req.headers["sec-fetch-site"] === "cross-site" ||
        (originHost && originHost !== req.headers.host)
      ) {
        return res
          .status(403)
          .json({ error: "Запрос разрешён только из приложения." });
      }
      if (!req.is("application/json"))
        return res.status(415).json({ error: "Нужен JSON-запрос." });
    }
    next();
  });
  app.use("/api", express.json({ limit: "8kb" }));
  app.use(
    "/api",
    session({
      name: sessionName,
      secret: store.secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "strict",
        secure: "auto",
        maxAge: SESSION_LIFETIME,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    req.context = contextFor(req.sessionID, req.session.auth);
    next();
  });
  /** @type {import('express').RequestHandler} */
  const requireLogin = (req, res, next) => {
    if (!req.context)
      return res.status(401).json({
        error: "Сессия истекла. Войди в Stud.IP заново.",
        code: "SESSION_EXPIRED",
      });
    next();
  };
  app.get("/api/state", (req, res) => {
    const context = req.context;
    if (!context)
      return res.json({
        authenticated: false,
        authExpired: Boolean(req.headers.cookie?.includes(`${sessionName}=`)),
      });
    const status = statusFor(context);
    /** @type {import('../shared/studip.js').Feed} */
    const feed = {
      ...(state.accounts[context.user.id] ?? empty()),
      authenticated: true,
      mode: "live",
      user: { id: context.user.id, name: context.user.name },
      syncing: status.syncing,
      error: status.error,
      source: BASE,
    };
    res.json(feed);
  });
  app.get("/api/demo", (req, res) => {
    /** @type {import('../shared/studip.js').Feed} */
    const feed = {
      ...state.demo,
      authenticated: false,
      mode: "demo",
      user: null,
      syncing: false,
      error: null,
      source: BASE,
    };
    res.json(feed);
  });
  app.get("/api/demo/courses/:id/folders", (req, res) => {
    if (!state.demo.courses.some((course) => course.id === req.params.id))
      throw new StudipError("Курс не найден.", 404);
    res.json(createDemoFolders(req.params.id, state.demo.resources));
  });
  app.use("/api/auth", authRoutes({ authenticate, contexts, contextFor, sync, sessionName }));
  app.post("/api/sync", requireLogin, async (req, res) => {
    await sync(req.context);
    res.json({ ok: true });
  });
  app.use("/api", gitlabRoutes({ state, save, requireLogin, gitlabTokens, getGitlabReadme, getGitlabTree, getGitlabBranches, getGitlabCommits, getGitlabCommit, getGitlabFile, getGitlabContent }));
  app.use("/api", fileRoutes({ state, save, expire, requireLogin, getFolders, getDownload, fileCache }));
  app.get("/api/changes", requireLogin, (req, res) => {
    const since = req.query.since;
    if (since && Number.isNaN(Date.parse(String(since))))
      return res.status(400).json({ error: "Некорректная дата since." });
    const current = state.accounts[req.context.user.id] ?? empty();
    res.json({
      changes: current.changes.filter(
        (c) => !since || Date.parse(c.occurredAt) > Date.parse(String(since)),
      ),
      lastSync: current.lastSync,
    });
  });
  app.post("/api/changes/read", requireLogin, async (req, res) => {
    const { id } = req.body;
    if (typeof id !== "string")
      throw new StudipError("Некорректная запись.", 400);
    const current = state.accounts[req.context.user.id] ?? empty();
    const change = current.changes.find((c) => c.id === id);
    if (!change) throw new StudipError("Запись не найдена.", 404);
    change.read = true;
    await save();
    res.json({ ok: true });
  });
  app.use("/api/nextcloud", nextcloudRoutes(nextcloudClient));
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Маршрут не найден." }),
  );
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({
      error:
        err instanceof StudipError || err instanceof GitlabError
          ? err.message
          : "Не удалось выполнить запрос.",
      ...(err.status === 401 ? { code: "SESSION_EXPIRED" } : {}),
      ...(err instanceof GitlabError ? { code: err.code } : {}),
    }),
  );

  let timer;
  if (autoSync) {
    const saved = await call(store, "all");
    for (const [id, value] of Object.entries(saved))
      if (value.auth) contextFor(id, value.auth);
    const poll = async () => {
      for (const context of contexts.values()) {
        if (!(await call(store, "get", context.sessionId))) {
          contexts.delete(context.sessionId);
          continue;
        }
        const status = statusFor(context);
        if (!status.syncing && Date.now() - status.lastAttempt >= 5 * 60000)
          void sync(context).catch(() => {});
      }
    };
    timer = setInterval(() => {
      void poll().catch(() => {});
    }, 30000);
    timer.unref();
    void poll().catch(() => {});
  }
  return {
    app,
    store,
    close: async () => {
      clearInterval(timer);
      for (const c of contexts.values()) c.revoked = true;
      await accountState.close();
      await fileCache.close();
      await store.queue;
      await gitlabTokens.close();
    },
  };
}
