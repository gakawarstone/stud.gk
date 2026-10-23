import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudipError } from "./studip.js";
import { previewType } from "./file-preview.js";

/** @param {import('./types.js').RouteState & {
 * expire: (context: import('./types.js').Context) => Promise<void>,
 * getFolders: NonNullable<import('./types.js').AppOptions['getFolders']>,
 * getDownload: NonNullable<import('./types.js').AppOptions['getDownload']>,
 * fileCache: Awaited<ReturnType<typeof import('./file-cache.js').createFileCache>>
 * }} options */
export function fileRoutes({ state, save, expire, requireLogin, getFolders, getDownload, fileCache }) {
  const router = Router();
  router.get("/courses/:id/folders", requireLogin, async (req, res) => {
    const context = req.context;
    const account = state.accounts[context.user.id];
    if (!account?.courses.some((course) => course.id === req.params.id))
      throw new StudipError("Курс не найден в твоих курсах.", 404);
    try {
      const result = await getFolders(context.client, String(req.params.id));
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
  router.get(
    [
      "/files/:id/download",
      "/files/:id/preview",
      "/files/:id/content",
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
        const options = {
          signal: controller.signal,
          range: req.headers.range,
        };
        const load = (options) => getDownload(context.client, file, options);
        const unavailable = state.accounts[context.user.id].unavailableSources?.some(
          (source) => source.kind === "file" && source.courseId === file.courseId);
        const response = unavailable
          ? await load(options)
          : await fileCache.download(context.user.id, file, load, options);
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
        await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), res, {
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
  return router;
}
