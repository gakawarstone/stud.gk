import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { createNextcloudClient, filePath, isPublicAddress, NextcloudError, parseListing, shareInfo, publicRequest } from "./nextcloud.js";

const share = "https://cloud.example.org/nextcloud/index.php/s/shareToken";
const root = new URL("https://cloud.example.org/nextcloud/public.php/dav/files/shareToken/");
function entry(href, name, directory = false, status = 200) {
  return `<z:response><z:href>${href}</z:href><z:propstat><z:prop><z:displayname>${name}</z:displayname><z:resourcetype>${directory ? '<z:collection/>' : ''}</z:resourcetype><z:getcontentlength>7</z:getcontentlength><z:getcontenttype>video/mp4</z:getcontenttype><z:getlastmodified>Wed, 14 Oct 2026 07:18:09 GMT</z:getlastmodified><z:getetag>&quot;etag&quot;</z:getetag></z:prop><z:status>HTTP/1.1 ${status} Result</z:status></z:propstat></z:response>`;
}
const xml = (...entries) => `<z:multistatus xmlns:z="DAV:">${entries.join('')}</z:multistatus>`;

test("Nextcloud share parsing preserves installations and prevents path traversal", () => {
  assert.equal(shareInfo(share).prefix, "/nextcloud");
  assert.equal(shareInfo("https://cloud.example.org/s/shareToken").prefix, "");
  assert.equal(shareInfo("https://cloud.example.org/apps/cloud/s/shareToken?path=%2F").prefix, "/apps/cloud");
  for (const value of ["https://cloud.example.org/login", "file:///s/token", "https://user:secret@cloud.example.org/s/token", null, {}, 12]) {
    assert.throws(() => shareInfo(value), NextcloudError);
  }
  assert.equal(filePath("/Lectures/Kotlin & Web.mp4/"), "Lectures/Kotlin & Web.mp4");
  for (const value of ["../secret", "a/../../secret", "a/./b", "a\\b", "a\n", {}]) assert.throws(() => filePath(value), NextcloudError);
});

test("Nextcloud connections reject local, mapped and special-purpose addresses", async () => {
  for (const address of ["127.0.0.1", "10.1.1.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "0.0.0.0", "100.100.0.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  await assert.rejects(publicRequest(new URL("http://127.0.0.1/public.php/dav/files/token/")), (error) => error.status === 400);
});

test("WebDAV listing handles namespaces, successful properties, folders and escaped names", () => {
  const listing = parseListing(xml(
    entry(root.pathname, "Курс", true),
    entry(root.pathname + "Kotlin%20%26%20Web.mp4", "Kotlin &amp; Web.mp4"),
    entry(root.pathname + "Notes/", "Notes", true),
    entry(root.pathname + "Notes/deep.pdf", "Deep"),
    entry(root.pathname + "denied.mp4", "Denied", false, 403),
    entry("https://evil.example/nextcloud/public.php/dav/files/shareToken/file", "Foreign"),
    entry("/nextcloud/public.php/dav/files/other/file", "Other share"),
  ), root);
  assert.equal(listing.title, "Курс");
  assert.deepEqual(listing.entries.map((file) => file.name), ["Notes", "Kotlin & Web.mp4"]);
  assert.equal(listing.entries[1].path, "Kotlin & Web.mp4");
  assert.equal(listing.entries[1].modified, "2026-10-14T07:18:09.000Z");
  const nested = parseListing(xml(entry(root.pathname + "Notes/", "Notes", true), entry(root.pathname + "Notes/lecture.pdf", "Lecture")), root, "Notes");
  assert.equal(nested.entries[0].path, "Notes/lecture.pdf");
  assert.equal(parseListing(xml(entry(root.pathname, "Single file.mp4")), root).entries[0].path, "");
  assert.equal(parseListing(xml(entry(root.pathname.slice(0, -1), "Single file.mp4")), root).entries[0].name, "Single file.mp4");
  assert.throws(() => parseListing("<html>login</html>", root), NextcloudError);
});

test("Nextcloud client reads only the requested share, encodes paths and forwards single byte ranges", async () => {
  const calls = [];
  const client = createNextcloudClient(async (url, options) => {
    calls.push({ url, options });
    return options.method === "PROPFIND" ? new Response(xml(entry(root.pathname, "Course", true)), { status: 207 })
      : new Response("mp4", { status: 206, headers: { "Content-Type": "video/mp4" } });
  });
  await client.list(share);
  assert.equal(calls[0].url.href, root.href);
  assert.equal(calls[0].options.method, "PROPFIND");
  assert.equal(calls[0].options.headers.Depth, "1");
  assert.equal(calls[0].options.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("shareToken:").toString("base64")}`);
  assert.equal(calls[0].options.headers.Cookie, undefined);
  await client.content(share, "Übung/Kotlin & Web.mp4", { range: "bytes=0-1023" });
  assert.equal(calls[1].url.pathname, root.pathname + "%C3%9Cbung/Kotlin%20%26%20Web.mp4");
  assert.equal(calls[1].options.headers.Range, "bytes=0-1023");
  await client.content(share, "file.mp4", { range: "bytes=0-1,3-4" });
  assert.equal(calls[2].options.headers.Range, undefined);
});

test("Nextcloud client supports legacy shares and reports protected, deleted and redirected shares", async () => {
  const calls = [];
  const client = createNextcloudClient(async (url) => {
    calls.push(url.pathname);
    return calls.length === 1 ? new Response("", { status: 404 })
      : new Response(xml(entry("/nextcloud/public.php/webdav/", "Legacy", true)), { status: 207 });
  });
  assert.equal((await client.list(share)).backend, "webdav");
  assert.equal(calls[1], "/nextcloud/public.php/webdav/");
  for (const status of [401, 403, 404, 302, 500]) {
    let requests = 0;
    const failing = createNextcloudClient(async () => { requests++; return new Response("", { status, headers: { Location: "https://other.example/" } }); });
    await assert.rejects(failing.content(share, "file"), NextcloudError);
    assert.equal(requests, 1);
  }
});

test("Nextcloud API streams ranged media, safe text and downloads without exposing upstream cookies", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nextcloud-api-"));
  const calls = [];
  const client = {
    list: async (url, path) => ({ title: "Course", path, backend: "dav", entries: [] }),
    content: async (url, path, options) => {
      calls.push({ url, path, options });
      if (path === "missing") throw new NextcloudError("Missing", 404);
      if (options.range === "bytes=999-") return new Response("", { status: 416, headers: { "Content-Range": "bytes */7" } });
      return new Response(path.endsWith(".html") ? "<script>unsafe()</script>" : "mp4", {
        status: options.range ? 206 : 200,
        headers: { "Content-Type": path.endsWith(".html") ? "text/html" : "video/mp4", "Content-Length": path.endsWith(".html") ? "25" : "3", "Content-Range": "bytes 0-2/7", "Accept-Ranges": "bytes", "Set-Cookie": "secret=private" },
      });
    },
  };
  const instance = await createApp({ dataDir: directory, autoSync: false, nextcloudClient: client });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/nextcloud`;
  const route = (path, mode = "preview") => `${base}/file/${mode}?${new URLSearchParams({ share, path })}`;
  try {
    const list = await fetch(`${base}/list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: share }) });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).title, "Course");
    const media = await fetch(route("video.mp4"), { headers: { Range: "bytes=0-2" } });
    assert.equal(media.status, 206);
    assert.equal(media.headers.get("content-range"), "bytes 0-2/7");
    assert.equal(media.headers.get("set-cookie"), null);
    assert.equal(media.headers.get("content-type"), "video/mp4");
    assert.match(media.headers.get("content-disposition"), /^inline/);
    assert.equal(await media.text(), "mp4");
    assert.equal(calls[0].options.range, "bytes=0-2");
    const text = await fetch(route("unsafe.html"));
    assert.match(text.headers.get("content-type"), /^text\/plain/);
    assert.equal(await text.text(), "<script>unsafe()</script>");
    const download = await fetch(route("video.mp4", "download"));
    assert.match(download.headers.get("content-disposition"), /^attachment/);
    await download.body.cancel();
    const invalidRange = await fetch(route("video.mp4"), { headers: { Range: "bytes=999-" } });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), "bytes */7");
    const missing = await fetch(route("missing"));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "NEXTCLOUD_ERROR");
    const crossSite = await fetch(route("video.mp4"), { headers: { "Sec-Fetch-Site": "cross-site" } });
    assert.equal(crossSite.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});
