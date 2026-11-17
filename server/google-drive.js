import { Router } from "express";
import { load } from "cheerio";

const idPattern = /^[a-zA-Z0-9_-]{10,200}$/;
export function googleDriveFolderId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.username || url.password) return null;
    const id = /^\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    return id && idPattern.test(id) ? id : null;
  } catch { return null; }
}
export function googleDriveRoutes() {
  const router = Router();
  router.post("/list", async (req, res) => {
    const id = googleDriveFolderId(req.body?.url);
    if (!id) return res.status(400).json({ error: "Enter a Google Drive folder link." });
    try {
      const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`, { redirect: "error", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Folder unavailable");
      const html = await response.text();
      if (html.length > 4 * 1024 * 1024) throw new Error("Folder is too large");
      const $ = load(html);
      if (!$('.flip-entries').length) throw new Error("Folder unavailable");
      const entries = $('.flip-entry').map((_, el) => {
        const entry = $(el);
        const entryId = (entry.attr('id') || '').replace(/^entry-/, '');
        const href = entry.find('a').first().attr('href') || '';
        return { id: entryId, name: entry.find('.flip-entry-title').text(), directory: href.startsWith('https://drive.google.com/drive/folders/') };
      }).get().filter(entry => idPattern.test(entry.id) && entry.name);
      res.json({ title: $('title').text(), entries });
    } catch {
      res.status(502).json({ error: "Could not load this folder. Check that the link is public." });
    }
  });
  return router;
}
