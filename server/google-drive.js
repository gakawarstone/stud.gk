import { Router } from "express";
import { load } from "cheerio";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { previewType } from "./file-preview.js";

const idPattern = /^[a-zA-Z0-9_-]{10,200}$/;
export function googleDriveFolderId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.host !== "drive.google.com" || url.username || url.password) return null;
    const id = /^\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return id && idPattern.test(id) ? id : null;
  } catch { return null; }
}

// Requests go only to these fixed Google hosts and never follow redirects.
export function googleDriveRoutes(request = fetch) {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cross-Origin-Resource-Policy", "same-origin");
    if (req.headers["sec-fetch-site"] === "cross-site") return res.status(403).json({ error: "Requests are only allowed from the app." });
    next();
  });
  router.post("/list", async (req, res) => {
    const id = googleDriveFolderId(req.body?.url);
    if (!id) return res.status(400).json({ error: "Enter a Google Drive folder link." });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on("close", cancel);
    try {
      const target = new URL("https://drive.google.com/embeddedfolderview");
      target.searchParams.set("id", id);
      const resourceKey = new URL(req.body.url).searchParams.get("resourcekey");
      if (resourceKey && /^[\w-]{1,200}$/.test(resourceKey)) target.searchParams.set("resourcekey", resourceKey);
      const response = await request(target, { redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!response.ok || !response.body) throw new Error("Folder unavailable");
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("Folder is too large"); }
        chunks.push(value);
      }
      const $ = load(Buffer.concat(chunks).toString("utf8"));
      if (!$('.flip-entries').length) throw new Error("Folder unavailable");
      const entries = $('.flip-entry').map((_, el) => {
        const entry = $(el);
        const entryId = (entry.attr('id') || '').replace(/^entry-/, '');
        const href = entry.find('a').first().attr('href') || '';
        const directory = href.startsWith('https://drive.google.com/drive/folders/');
        let resourceKey = "";
        try { resourceKey = new URL(href).searchParams.get("resourcekey") || ""; } catch { /* Ignore malformed links. */ }
        if (!/^[\w-]{0,200}$/.test(resourceKey)) resourceKey = "";
        return { id: entryId, path: entryId, name: entry.find('.flip-entry-title').text(), directory, mime: "", size: 0, modified: null, etag: "", resourceKey };
      }).get().filter(entry => idPattern.test(entry.id) && entry.name);
      res.json({ title: $('title').text(), entries });
    } catch {
      if (!controller.signal.aborted) res.status(502).json({ error: "Could not load this folder. Check that the link is public." });
    } finally { res.off("close", cancel); }
  });
  router.get("/file/:mode", async (req, res) => {
    const { mode } = req.params;
    const { id, name, resourceKey } = req.query;
    if (!['preview', 'download'].includes(mode) || typeof id !== 'string' || !idPattern.test(id) || typeof name !== 'string' || name.length > 1000 || (resourceKey !== undefined && (typeof resourceKey !== 'string' || !/^[\w-]{0,200}$/.test(resourceKey)))) return res.status(400).json({ error: "Invalid Google Drive file." });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on("close", cancel);
    try {
      const target = new URL("https://drive.usercontent.google.com/download");
      target.searchParams.set("id", id);
      target.searchParams.set("export", "download");
      target.searchParams.set("confirm", "t");
      if (typeof resourceKey === "string" && resourceKey) target.searchParams.set("resourcekey", resourceKey);
      const headers = { "Accept-Encoding": "identity" };
      if (/^bytes=\d*-\d*$/.test(req.headers.range || "")) headers["Range"] = req.headers.range;
      const timeout = setTimeout(() => controller.abort(), 30000);
      let upstream;
      try { upstream = await request(target, { headers, redirect: "error", signal: controller.signal }); } finally { clearTimeout(timeout); }
      if (upstream.status === 416) {
        const range = upstream.headers.get("content-range");
        if (/^bytes \*\/\d+$/.test(range || "")) res.set("Content-Range", range);
        await upstream.body?.cancel();
        return res.status(416).end();
      }
      if (![200, 206].includes(upstream.status) || !upstream.body || /text\/html/i.test(upstream.headers.get("content-type") || "")) {
        await upstream.body?.cancel();
        return res.status(502).json({ error: "Could not retrieve the file. It may not be publicly downloadable." });
      }
      const filename = name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200) || "file";
      const type = previewType({ title: filename }, upstream);
      res.status(upstream.status).attachment(filename).type(type || "application/octet-stream");
      if (mode === "preview" && type) res.set("Content-Disposition", res.get("Content-Disposition").replace(/^attachment/, "inline"));
      res.set("Content-Security-Policy", "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      const length = upstream.headers.get("content-length");
      if (/^\d+$/.test(length || "") && !upstream.headers.get("content-encoding")) res.set("Content-Length", length);
      const range = upstream.headers.get("content-range");
      if (upstream.status === 206 && /^bytes \d+-\d+\/\d+$/.test(range || "")) res.set("Content-Range", range);
      if (upstream.headers.get("accept-ranges") === "bytes") res.set("Accept-Ranges", "bytes");
      await pipeline(Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (/** @type {unknown} */ (upstream.body))), res, { signal: controller.signal });
    } catch {
      if (!res.headersSent && !res.destroyed) res.status(502).json({ error: "Could not retrieve the file from Google Drive." });
      else if (!res.destroyed) res.destroy();
    } finally { res.off("close", cancel); }
  });
  return router;
}
