import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { load } from "cheerio";

export class NextcloudError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** @type {[string, number][]} */
const blockedSubnets = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]];
const blocked = new BlockList();
for (const [address, prefix] of blockedSubnets) {
  blocked.addSubnet(address, prefix, "ipv4");
}
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function shareInfo(value) {
  if (typeof value !== "string") throw new NextcloudError("Укажи публичную ссылку Nextcloud.", 400);
  let url;
  try { url = new URL(value); } catch { /* Report the same validation error below. */ }
  const match = url?.pathname.match(/^(.*?)(?:\/index\.php)?\/s\/([a-zA-Z0-9_-]+)\/?$/);
  if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password || !match || value.length > 4096) {
    throw new NextcloudError("Введи публичную ссылку Nextcloud вида https://cloud.example.org/s/…", 400);
  }
  return { url, prefix: match[1], token: match[2] };
}

export function filePath(value = "") {
  if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value)) {
    throw new NextcloudError("Некорректный путь Nextcloud.", 400);
  }
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new NextcloudError("Некорректный путь Nextcloud.", 400);
  return parts.join("/");
}

function davUrl(share, path, backend) {
  const base = backend === "webdav" ? `${share.prefix}/public.php/webdav/`
    : `${share.prefix}/public.php/dav/files/${share.token}/`;
  return new URL(base + filePath(path).split("/").filter(Boolean).map(encodeURIComponent).join("/"), share.url.origin);
}

// Resolve once, reject local networks, and pin the checked address to the connection.
// Redirects are returned to the caller and never followed with share credentials.
/** @param {URL} url @param {import('./types.js').PublicRequestOptions} options @returns {Promise<Response>} */
export async function publicRequest(url, { method = "GET", headers = {}, body, signal } = {}) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new NextcloudError("Nextcloud должен быть доступен по публичному адресу сервера.", 400);
  }
  const address = addresses.find((entry) => entry.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method, headers, signal, agent: false,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      resolve(new Response(/** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(response)), { status: response.statusCode, headers: responseHeaders }));
    });
    request.setTimeout(30000, () => request.destroy(new Error("Nextcloud timeout")));
    request.on("error", reject);
    request.end(body);
  });
}

const properties = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>';

export function parseListing(xml, root, currentPath = "") {
  const $ = load(xml, { xml: true });
  const nodes = (parent, name) => $(parent).children().filter((_, node) => ("name" in node ? node.name : "").split(":").pop() === name);
  const responses = $("*").filter((_, node) => ("name" in node ? node.name : "").split(":").pop() === "response");
  if (!responses.length) throw new NextcloudError("Nextcloud вернул некорректный список файлов.");
  const entries = [];
  let title = "Nextcloud";
  for (const response of responses.toArray()) {
    const href = new URL(nodes(response, "href").text(), root);
    const basePath = root.pathname.replace(/\/$/, "");
    if (href.origin !== root.origin || (href.pathname !== basePath && !href.pathname.startsWith(`${basePath}/`))) continue;
    let path;
    try { path = filePath(decodeURIComponent(href.pathname.slice(basePath.length))); } catch { continue; }
    const prop = nodes(response, "propstat").filter((_, node) => /\s200\s/.test(nodes(node, "status").text())).toArray().flatMap((node) => nodes(node, "prop").toArray());
    const property = (name) => prop.map((node) => nodes(node, name).text()).join("");
    const directory = prop.some((node) => nodes(nodes(node, "resourcetype"), "collection").length > 0);
    const name = property("displayname") || path.split("/").pop() || "Nextcloud";
    if (path === currentPath) {
      title = name;
      // A public share may point at a single file instead of a folder.
      if (directory) continue;
    } else if (path.split("/").slice(0, -1).join("/") !== currentPath) continue;
    if (!prop.length) continue;
    const modified = Date.parse(property("getlastmodified"));
    entries.push({ path, name, directory, size: Number(property("getcontentlength")) || 0,
      mime: property("getcontenttype"), modified: Number.isFinite(modified) ? new Date(modified).toISOString() : null,
      etag: property("getetag") });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, "de", { numeric: true }));
  return { title, path: currentPath, entries };
}

async function checked(response) {
  if ([200, 206, 207].includes(response.status)) return response;
  await response.body?.cancel();
  if ([401, 403].includes(response.status)) throw new NextcloudError("Нет доступа к Nextcloud. Проверь ссылку: она должна быть публичной и без пароля.", 403);
  if (response.status === 404) throw new NextcloudError("Файл или ссылка Nextcloud больше не доступны.", 404);
  if (response.status >= 300 && response.status < 400) throw new NextcloudError("Nextcloud перенаправляет запрос. Вставь конечную ссылку на общую папку.");
  throw new NextcloudError("Не удалось получить файлы Nextcloud. Попробуй обновить список.");
}

export function createNextcloudClient(request = publicRequest) {
  function options(share, extra) {
    return { ...extra, headers: { "X-Requested-With": "XMLHttpRequest", "Accept-Encoding": "identity",
      Authorization: `Basic ${Buffer.from(`${share.token}:`).toString("base64")}`, ...extra.headers } };
  }
  return {
    /** @param {string} url @param {string} path @param {{signal?: AbortSignal}} options */
    async list(url, path = "", { signal } = {}) {
      const share = shareInfo(url);
      path = filePath(path);
      let backend = "dav";
      let response = await request(davUrl(share, path, backend), options(share, {
        method: "PROPFIND", headers: { Depth: "1", "Content-Type": "application/xml" }, body: properties, signal,
      }));
      if ([404, 405].includes(response.status)) {
        await response.body?.cancel();
        backend = "webdav";
        response = await request(davUrl(share, path, backend), options(share, {
          method: "PROPFIND", headers: { Depth: "1", "Content-Type": "application/xml" }, body: properties, signal,
        }));
      }
      await checked(response);
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new NextcloudError("В этой папке слишком много файлов. Открой отдельную подпапку по её ссылке."); }
        chunks.push(value);
      }
      return { ...parseListing(Buffer.concat(chunks).toString("utf8"), davUrl(share, "", backend), path), backend };
    },
    /** @param {string} url @param {string} path @param {import('./types.js').ReadOptions & {backend?: string}} options */
    async content(url, path, { backend = "dav", range, signal } = {}) {
      const share = shareInfo(url);
      const response = await request(davUrl(share, path, backend === "webdav" ? "webdav" : "dav"), options(share, {
        method: "GET", signal, headers: /^bytes=\d*-\d*$/.test(range || "") ? { Range: range } : {},
      }));
      if (response.status === 416) return response;
      return checked(response);
    },
  };
}
