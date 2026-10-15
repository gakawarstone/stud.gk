import express from "express";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import { CookieJar } from "tough-cookie";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BASE, createClient, fetchSnapshot, fetchCourseFolders, StudipError } from "./studip.js";
import { loginStudip } from "./login.js";
import {
  EncryptedSessionStore,
  SESSION_NAME,
  SESSION_LIFETIME,
} from "./sessions.js";
import { reconcile } from "./changes.js";
import { createDemo, createDemoFolders } from "./demo.js";

const call = (object, method, ...args) =>
  new Promise((resolve, reject) =>
    object[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
const empty = () => ({
  courses: [],
  resources: [],
  changes: [],
  lastSync: null,
  semester: "",
});
const previewTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "video/ogg",
]);
function previewType(file, response) {
  for (const value of [file.mime, response.headers.get("content-type")]) {
    const type = value?.split(";")[0].trim().toLowerCase();
    if (previewTypes.has(type)) return type;
    if (
      type?.startsWith("text/") ||
      type === "image/svg+xml" ||
      type === "application/json"
    )
      return "text/plain";
  }
  const extensions = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".csv": "text/plain",
    ".json": "text/plain",
    ".html": "text/plain",
    ".htm": "text/plain",
    ".svg": "text/plain",
    ".js": "text/plain",
    ".css": "text/plain",
  };
  return extensions[path.extname(file.title).toLowerCase()] || null;
}

export async function createApp({
  dataDir,
  authenticate = loginStudip,
  getSnapshot = fetchSnapshot,
  getFolders = fetchCourseFolders,
  getDownload = (client, file, options) => client.download(file, options),
  autoSync = true,
  sessionName = SESSION_NAME,
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(dataDir, "state.json");
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error("Cannot read saved course data.");
  }
  state ??= { accounts: {} };
  // Demo fixtures are not account data and must follow the current UI schema.
  state.demo = createDemo();
  state.accounts = Object.assign(Object.create(null), state.accounts);
  const store = await EncryptedSessionStore.open(dataDir);
  let saveQueue = Promise.resolve();
  function save() {
    const json = JSON.stringify(state);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        await writeFile(`${statePath}.tmp`, json, { mode: 0o600 });
        await rename(`${statePath}.tmp`, statePath);
      });
    return saveQueue;
  }
  const contexts = new Map(),
    statuses = new Map();
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
  function statusFor(context) {
    if (!statuses.has(context.user.id))
      statuses.set(context.user.id, {
        syncing: false,
        error: null,
        lastAttempt: 0,
      });
    return statuses.get(context.user.id);
  }
  async function expire(context) {
    context.revoked = true;
    contexts.delete(context.sessionId);
    await call(store, "destroy", context.sessionId);
  }
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
      state.accounts[context.user.id] = reconcile(
        state.accounts[context.user.id],
        snapshot,
      );
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
  function requireLogin(req, res, next) {
    if (!req.context)
      return res.status(401).json({
        error: "Сессия истекла. Войди в Stud.IP заново.",
        code: "SESSION_EXPIRED",
      });
    next();
  }
  app.get("/api/state", (req, res) => {
    const context = req.context;
    if (!context)
      return res.json({
        authenticated: false,
        authExpired: Boolean(req.headers.cookie?.includes(`${sessionName}=`)),
      });
    const status = statusFor(context);
    res.json({
      ...(state.accounts[context.user.id] ?? empty()),
      authenticated: true,
      mode: "live",
      user: { id: context.user.id, name: context.user.name },
      syncing: status.syncing,
      error: status.error,
      source: BASE,
    });
  });
  app.get("/api/demo", (req, res) =>
    res.json({
      ...state.demo,
      authenticated: false,
      mode: "demo",
      user: null,
      syncing: false,
      error: null,
      source: BASE,
    }),
  );
  app.get("/api/demo/courses/:id/folders", (req, res) => {
    if (!state.demo.courses.some((course) => course.id === req.params.id))
      throw new StudipError("Курс не найден.", 404);
    res.json(createDemoFolders(req.params.id, state.demo.resources));
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: "Слишком много попыток входа. Подожди 15 минут и попробуй снова.",
    },
  });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const result = await authenticate(req.body.username, req.body.password);
    const previous = contexts.get(req.sessionID);
    await call(req.session, "regenerate");
    if (previous) {
      previous.revoked = true;
      contexts.delete(previous.sessionId);
    }
    req.session.auth = {
      user: result.user,
      jar: result.jar.toJSON(),
      expiresAt: Date.now() + SESSION_LIFETIME,
    };
    await call(req.session, "save");
    const context = contextFor(req.sessionID, req.session.auth);
    void sync(context).catch(() => {});
    res.json({ ok: true, user: { name: result.user.name } });
  });
  app.post("/api/auth/logout", async (req, res) => {
    const context = req.context;
    if (context) {
      context.revoked = true;
      contexts.delete(context.sessionId);
    }
    await call(req.session, "destroy");
    res.clearCookie(sessionName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
    });
    res.json({ ok: true });
  });
  app.post("/api/sync", requireLogin, async (req, res) => {
    await sync(req.context);
    res.json({ ok: true });
  });
  app.get("/api/courses/:id/folders", requireLogin, async (req, res) => {
    const context = req.context;
    const account = state.accounts[context.user.id];
    if (!account?.courses.some((course) => course.id === req.params.id))
      throw new StudipError("Курс не найден в твоих курсах.", 404);
    try {
      const result = await getFolders(context.client, req.params.id);
      if (context.revoked || context.expiresAt <= Date.now())
        throw new StudipError("Сессия истекла. Войди в Stud.IP заново.", 401);
      const allowedFiles = new Set(account.resources
        .filter((file) => file.kind === "file" && file.courseId === req.params.id)
        .map((file) => file.remoteId));
      res.json({
        ...result,
        fileFolders: result.fileFolders.filter((file) => allowedFiles.has(file.fileRefId)),
      });
    } catch (error) {
      if (error.status === 401) await expire(context);
      throw error;
    }
  });
  app.get(
    [
      "/api/files/:id/download",
      "/api/files/:id/preview",
      "/api/files/:id/content",
    ],
    requireLogin,
    async (req, res) => {
      const thumbnail = req.path.endsWith("/content");
      const preview = thumbnail || req.path.endsWith("/preview");
      const context = req.context;
      const file = state.accounts[context.user.id]?.resources.find(
        (r) => r.kind === "file" && r.remoteId === req.params.id,
      );
      if (!file) throw new StudipError("Файл не найден в твоих курсах.", 404);
      const controller = new AbortController();
      const cancel = () => {
        if (!res.writableFinished) controller.abort();
      };
      res.once("close", cancel);
      try {
        const response = await getDownload(context.client, file, {
          signal: controller.signal,
          range: req.headers.range,
        });
        if (context.revoked || context.expiresAt <= Date.now()) {
          await response.body.cancel();
          throw new StudipError("Сессия истекла. Войди заново.", 401);
        }
        const contentType = preview
          ? previewType(file, response)
          : "application/octet-stream";
        if (!contentType) {
          await response.body.cancel();
          const title = file.title.replace(
            /[&<>"']/g,
            (char) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[char],
          );
          return res
            .status(415)
            .type("html")
            .send(
              `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Просмотр файла</title><style>body{margin:0;padding:48px 24px;background:#1e1e2e;color:#cdd6f4;font:16px/1.6 system-ui}main{max-width:600px;margin:auto}h1{font-size:24px;overflow-wrap:anywhere}p{color:#a6adc8}a{display:inline-block;padding:10px 18px;border-radius:8px;background:#cba6f7;color:#181825;text-decoration:none}</style></head><body><main><h1>${title}</h1><p>Браузер не поддерживает просмотр этого формата.</p><a href="/api/files/${encodeURIComponent(file.remoteId)}/download">Скачать файл</a></main></body></html>`,
            );
        }
        const filename =
          file.title.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200) ||
          "file";
        res.status(response.status).attachment(filename).type(contentType);
        if (preview) {
          res.set(
            "Content-Disposition",
            res.get("Content-Disposition").replace(/^attachment/, "inline"),
          );
        }
        const length = response.headers.get("content-length");
        if (
          /^\d+$/.test(length ?? "") &&
          !response.headers.get("content-encoding")
        )
          res.set("Content-Length", length);
        if (response.status === 206) {
          const contentRange = response.headers.get("content-range");
          if (/^bytes \d+-\d+\/\d+$/.test(contentRange ?? ""))
            res.set("Content-Range", contentRange);
        }
        if (response.headers.get("accept-ranges") === "bytes")
          res.set("Accept-Ranges", "bytes");
        await pipeline(Readable.fromWeb(response.body), res, {
          signal: controller.signal,
        });
        // Only a completed full transfer marks related Stud.GK notifications read.
        if (!thumbnail && response.status === 200 && !context.revoked) {
          const account = state.accounts[context.user.id];
          for (const change of account.changes)
            if (change.resourceId === file.id) change.read = true;
          await save();
        }
      } catch (error) {
        if (error.status === 401) await expire(context);
        if (!res.headersSent && !controller.signal.aborted) throw error;
        if (!res.destroyed) res.destroy();
      } finally {
        res.off("close", cancel);
      }
    },
  );
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
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Маршрут не найден." }),
  );
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({
      error:
        err instanceof StudipError
          ? err.message
          : "Не удалось выполнить запрос.",
      ...(err.status === 401 ? { code: "SESSION_EXPIRED" } : {}),
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
      await saveQueue;
      await store.queue;
    },
  };
}
