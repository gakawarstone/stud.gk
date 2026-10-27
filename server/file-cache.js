import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const FILE_CACHE_BYTES = 512 * 1024 * 1024;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const keyFor = (account, file) => hash([
  account, file.id, file.remoteId, file.fileId, file.courseId,
  file.title, file.size, file.mime, file.createdAt, file.updatedAt,
]);

// Only complete, unencoded responses are reusable across previews and downloads.
/** @param {string} directory @param {{maxBytes?: number}} options */
export async function createFileCache(directory, { maxBytes = FILE_CACHE_BYTES } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = new Map();
  const active = new Map();
  const writing = new Set();
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const filename = (key, suffix) => path.join(directory, `${key}.${suffix}`);
  async function remove(key) {
    entries.delete(key);
    await Promise.all(["bin", "json"].map((suffix) => rm(filename(key, suffix), { force: true })));
  }
  async function trim() {
    let size = [...entries.values()].reduce((total, entry) => total + entry.size, 0);
    for (const [key, entry] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
      if (size <= maxBytes) break;
      await remove(key);
      size -= entry.size;
    }
  }
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const key = name.slice(0, -5);
    try {
      const entry = JSON.parse(await readFile(filename(key, "json"), "utf8"));
      const info = await stat(filename(key, "bin"));
      if (!/^[a-f0-9]{64}$/.test(entry.account) ||
          !Number.isSafeInteger(entry.size) || entry.size < 0 ||
          info.size !== entry.size || typeof entry.type !== "string") throw new Error("Invalid cache entry");
      entries.set(key, { ...entry, used: info.mtimeMs });
    } catch {
      await remove(key);
    }
  }
  // Remove interrupted writes and payloads without a committed metadata file.
  for (const name of await readdir(directory)) {
    if (name.endsWith(".tmp") || (/^[a-f0-9]{64}\.bin$/.test(name) && !entries.has(name.slice(0, -4))))
      await rm(path.join(directory, name), { force: true });
  }
  await trim();

  /** @param {string} key @param {import('./types.js').ReadOptions} options */
  async function cached(key, { signal, range }) {
    const entry = entries.get(key);
    if (!entry) return null;
    // Keep the same single-range syntax as the Stud.IP client.
    const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
    if (range && !match) return null;
    let start = 0, end = entry.size - 1;
    if (match) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end)
        return null;
    }
    let handle;
    try {
      handle = await open(filename(key, "bin"), "r");
      if ((await handle.stat()).size !== entry.size) throw new Error("Incomplete cache entry");
    } catch {
      await handle?.close();
      await serial(() => remove(key)).catch(() => {});
      return null;
    }
    entry.used = Date.now();
    await handle.utimes(new Date(entry.used), new Date(entry.used)).catch(() => {});
    const headers = {
      "Content-Type": entry.type,
      "Content-Length": String(match ? end - start + 1 : entry.size),
      "Accept-Ranges": "bytes",
    };
    if (match) headers["Content-Range"] = `bytes ${start}-${end}/${entry.size}`;
    /** @type {BodyInit} */
    let body = new Uint8Array();
    if (entry.size) body = /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(handle.createReadStream({ start, end, signal })));
    else await handle.close();
    return new Response(body, { status: match ? 206 : 200, headers });
  }

  return {
    /** @param {string} account @param {import('../shared/studip.js').CourseResource[]} files */
    async prune(account, files) {
      const accountKey = hash(account);
      const keys = new Set(files.filter((file) => file.kind === "file").map((file) => keyFor(account, file)));
      active.set(accountKey, keys);
      await serial(async () => {
        for (const [key, entry] of entries)
          if (entry.account === accountKey && !keys.has(key)) await remove(key);
      }).catch(() => {});
    },
    /** @param {string} account @param {import('../shared/studip.js').CourseResource} file
     * @param {(options: import('./types.js').ReadOptions) => Promise<Response>} load
     * @param {import('./types.js').ReadOptions} options */
    async download(account, file, load, options = {}) {
      const key = keyFor(account, file);
      const hit = await cached(key, options);
      if (hit) return hit;
      const response = await load(options);
      const length = response.headers.get("content-length");
      if (response.status !== 200 || options.range || !response.body ||
          response.headers.has("content-encoding") || response.headers.has("content-range") ||
          Number(length) > maxBytes || maxBytes <= 0 || writing.has(key)) return response;
      const temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
      let handle;
      writing.add(key);
      try { handle = await open(temporary, "wx", 0o600); }
      catch {
        writing.delete(key);
        return response; // A full or read-only disk must not prevent viewing files.
      }
      const accountKey = hash(account);
      const reader = response.body.getReader();
      let size = 0, stopped = false, pending = Promise.resolve(), cleanup;
      const discard = () => cleanup ??= (async () => {
        await handle?.close().catch(() => {});
        handle = null;
        await rm(temporary, { force: true }).catch(() => {});
        writing.delete(key);
      })();
      const body = new ReadableStream({
        pull(controller) {
          pending = (async () => {
            try {
              const { done, value } = await reader.read();
              if (stopped) return;
              if (done) {
                if (handle && !options.signal?.aborted &&
                    (length === null || (/^\d+$/.test(length) && Number(length) === size))) {
                  try {
                    await handle.close();
                    handle = null;
                    await serial(async () => {
                      if (active.has(accountKey) && !active.get(accountKey).has(key)) return;
                      const entry = { account: accountKey, size, type: response.headers.get("content-type") || "application/octet-stream", used: Date.now() };
                      try {
                        await rename(temporary, filename(key, "bin"));
                        await writeFile(filename(key, "json"), JSON.stringify(entry), { mode: 0o600 });
                      } catch (error) {
                        await remove(key);
                        throw error;
                      }
                      entries.set(key, entry);
                      await trim();
                    });
                  } catch { /* Keep serving the file if writing the cache fails. */ }
                }
                await discard();
                if (!stopped) controller.close();
                return;
              }
              size += value.byteLength;
              if (handle) {
                try {
                  if (size > maxBytes) throw new Error("Cache limit exceeded");
                  await handle.writeFile(value);
                } catch {
                  await discard();
                }
              }
              if (!stopped) controller.enqueue(value);
            } catch (error) {
              await discard();
              if (!stopped) controller.error(error);
            }
          })();
          return pending;
        },
        async cancel(reason) {
          stopped = true;
          await reader.cancel(reason).catch(() => {});
          await pending;
          await discard();
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    },
    async close() { await queue; },
  };
}
