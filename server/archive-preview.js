import yauzl from "yauzl";
import { StudipError } from "./studip.js";

export const ARCHIVE_LIMIT = 32 * 1024 * 1024;
export const ENTRY_LIMIT = 1000;
export const isZip = (file) => /\.zip$/i.test(file.title);

/** Read metadata only. Never decompress or extract archive members.
 * @param {Response} response
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('../shared/archive.js').ArchiveContents>}
 */
export async function archiveContents(response, signal) {
  if (Number(response.headers.get("content-length")) > ARCHIVE_LIMIT) {
    await response.body.cancel();
    throw new StudipError("Archive preview is limited to 32 MB. Download the file to view it.", 413);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > ARCHIVE_LIMIT) throw new StudipError("Archive preview is limited to 32 MB. Download the file to view it.", 413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks, size);
  return new Promise((resolve, reject) => {
    const invalid = () => reject(new StudipError("Cannot preview this ZIP archive. Download the file to view it.", 415));
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return invalid();
      const entries = [];
      zip.on("error", () => { zip.close(); invalid(); });
      const finish = () => {
        zip.close();
        resolve({ entries, total: zip.entryCount, truncated: zip.entryCount > entries.length });
      };
      zip.on("end", finish);
      zip.on("entry", (entry) => {
        if (signal?.aborted) { zip.close(); reject(signal.reason); return; }
        entries.push({ name: entry.fileName, size: entry.uncompressedSize, directory: entry.fileName.endsWith("/") });
        if (entries.length >= ENTRY_LIMIT) finish();
        else zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
/** @param {import('../shared/studip.js').CourseResource} file
 * @param {import('../shared/archive.js').ArchiveContents} contents */
export function archivePage(file, contents) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(file.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#1e1e2e;color:#cdd6f4;font:15px/1.6 system-ui}main{max-width:960px;margin:auto;padding:40px 24px}header{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}h1{font-size:26px;margin:6px 0;overflow-wrap:anywhere}p{color:#a6adc8}a{padding:10px 18px;border-radius:8px;background:#cba6f7;color:#181825;text-decoration:none}.tag{color:#fab387;font-size:12px;letter-spacing:2px}table{width:100%;border-collapse:collapse;margin-top:24px;text-align:left}th{color:#a6adc8;font-weight:500}th,td{padding:12px;border-bottom:1px solid #313244}td:first-child{overflow-wrap:anywhere;word-break:break-word}td:last-child,th:last-child{text-align:right;white-space:nowrap}td:first-child{font-family:monospace}tbody tr:hover{background:#313244}
  </style></head><body><main><header><div><span class="tag">ZIP CONTENTS</span><h1>${escape(file.title)}</h1><p>${contents.total} entries</p></div><a href="/api/files/${encodeURIComponent(file.remoteId)}/download">Download ZIP</a></header>
  ${contents.entries.length ? `<table><thead><tr><th>File / folder</th><th>Size</th></tr></thead><tbody>${contents.entries.map((entry) => `<tr><td>${escape(entry.name)}</td><td>${entry.directory ? "Folder" : `${entry.size.toLocaleString("en-GB")} B`}</td></tr>`).join("")}</tbody></table>` : "<p>This archive is empty.</p>"}
  ${contents.truncated ? `<p>Showing the first ${ENTRY_LIMIT} entries. Download the archive to see all contents.</p>` : ""}</main></body></html>`;
}
