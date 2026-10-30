import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createNextcloudClient, NextcloudError, filePath } from "./nextcloud.js";
import { previewType } from "./file-preview.js";

export function nextcloudRoutes(client = createNextcloudClient()) {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cross-Origin-Resource-Policy", "same-origin");
    if (req.headers["sec-fetch-site"] === "cross-site") return res.status(403).json({ error: "Requests are only allowed from the app." });
    next();
  });
  router.post("/list", async (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on("close", cancel);
    try {
      if (typeof req.body?.url !== "string") throw new NextcloudError("Enter a Nextcloud URL.", 400);
      res.json(await client.list(req.body.url, filePath(req.body.path), { signal: controller.signal }));
    } finally { res.off("close", cancel); }
  });
  router.get("/file/:mode", async (req, res) => {
    if (!["preview", "download"].includes(req.params.mode) || typeof req.query.share !== "string" || typeof req.query.path !== "string") {
      throw new NextcloudError("Invalid Nextcloud file URL.", 400);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on("close", cancel);
    try {
      const path = filePath(req.query.path);
      const upstream = await client.content(req.query.share, path, { backend: typeof req.query.backend === "string" ? req.query.backend : undefined, range: req.headers.range, signal: controller.signal });
      if (upstream.status === 416) {
        await upstream.body?.cancel();
        const range = upstream.headers.get("content-range");
        if (/^bytes \*\/\d+$/.test(range || "")) res.set("Content-Range", range);
        return res.status(416).end();
      }
      const name = path.split("/").pop() || (typeof req.query.name === "string" ? req.query.name : "file");
      const filename = name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200) || "file";
      const type = previewType({ title: filename }, upstream);
      res.status(upstream.status).attachment(filename).type(type || "application/octet-stream");
      if (req.params.mode === "preview" && type) res.set("Content-Disposition", res.get("Content-Disposition").replace(/^attachment/, "inline"));
      res.set("Content-Security-Policy", "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      const length = upstream.headers.get("content-length");
      if (/^\d+$/.test(length || "") && !upstream.headers.get("content-encoding")) res.set("Content-Length", length);
      const range = upstream.headers.get("content-range");
      if (upstream.status === 206 && /^bytes \d+-\d+\/\d+$/.test(range || "")) res.set("Content-Range", range);
      if (upstream.headers.get("accept-ranges") === "bytes") res.set("Accept-Ranges", "bytes");
      await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
    } catch (error) {
      if (!res.headersSent && !controller.signal.aborted) throw error;
      if (!res.destroyed) res.destroy();
    } finally { res.off("close", cancel); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error instanceof NextcloudError ? error.status : 502).json({
      error: error instanceof NextcloudError ? error.message : "Could not connect to Nextcloud. Check the URL and your connection.",
      code: "NEXTCLOUD_ERROR",
    });
  });
  return router;
}
