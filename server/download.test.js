import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CookieJar } from "tough-cookie";
import { BASE, createClient, StudipError } from "./studip.js";
import { createApp } from "./app.js";

const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 10]);
const file = {
  id: "file:course:ref",
  remoteId: "ref",
  title: 'Лекция "1".pdf',
  courseId: "course",
  kind: "file",
};

test("downloads only from university sendfile with server cookies and a fixed GET", async () => {
  const jar = new CookieJar();
  await jar.setCookie("PHPSESSID=private; Secure; HttpOnly; Path=/", BASE);
  const calls = [];
  const client = createClient(jar, async (url, options) => {
    calls.push({ url, options });
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Set-Cookie": "PHPSESSID=refreshed; Secure; HttpOnly; Path=/",
      },
    });
  });
  const result = await client.download(file, { range: "bytes=0-6" });
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(calls[0].url.origin, BASE);
  assert.equal(calls[0].url.pathname, "/sendfile.php");
  assert.equal(calls[0].url.searchParams.get("file_id"), file.remoteId);
  assert.equal(calls[0].url.searchParams.get("file_name"), file.title);
  assert.equal(calls[0].url.searchParams.get("force_download"), "1");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.headers.Cookie, "PHPSESSID=private");
  assert.equal(calls[0].options.headers.Range, "bytes=0-6");
  assert.equal(calls[0].options.headers["Accept-Encoding"], "identity");
  assert.equal(await jar.getCookieString(BASE), "PHPSESSID=refreshed");
  await (await client.download(file, { range: "bytes=0-1,3-4" })).body.cancel();
  assert.equal(calls[1].options.headers.Range, undefined);
});

test("does not forward university cookies on redirects or save login pages as files", async () => {
  for (const [location, status] of [
    ["https://other.example/file.pdf", 502],
    ["/dispatch.php/start", 401],
  ]) {
    let calls = 0;
    const client = createClient("session=private", async () => {
      calls++;
      return new Response("", { status: 302, headers: { Location: location } });
    });
    await assert.rejects(client.download(file), (e) => e.status === status);
    assert.equal(calls, 1);
  }
  for (const status of [401, 403, 404]) {
    const client = createClient(
      "session=private",
      async () => new Response("", { status }),
    );
    await assert.rejects(client.download(file), (e) => e.status === status);
  }
  for (const authenticated of [true, false]) {
    const client = createClient("session=private", async (url) =>
      url.pathname === "/sendfile.php"
        ? new Response("<html>Login</html>", {
            headers: { "Content-Type": "text/html" },
          })
        : new Response(JSON.stringify({ data: { id: "u" } }), {
            status: authenticated ? 200 : 401,
          }),
    );
    await assert.rejects(
      client.download(file),
      (e) => e.status === (authenticated ? 502 : 401),
    );
  }
});

test("local downloads enforce account ownership, stream bytes and mark only completed full downloads read", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-download-"));
  let failure,
    calls = 0,
    cancelled = false;
  const counts = new Map();
  const instance = await createApp({
    dataDir: directory,
    autoSync: false,
    authenticate: async (username) => ({
      user: { id: username, name: username },
      jar: new CookieJar(),
    }),
    getSnapshot: async (client, user) => {
      const version = (counts.get(user.id) || 0) + 1;
      counts.set(user.id, version);
      return {
        courses: [{ id: user.id }],
        resources: [
          {
            ...file,
            remoteId: `${user.id}-ref`,
            id: `${user.id}-file`,
            courseId: user.id,
            size: version,
          },
          {
            ...file,
            id: `${user.id}-html`,
            remoteId: `${user.id}-html`,
            title: "example.html",
            courseId: user.id,
          },
          {
            ...file,
            id: `${user.id}-zip`,
            remoteId: `${user.id}-zip`,
            title: "archive.zip",
            courseId: user.id,
          },
        ],
        semester: "WS",
      };
    },
    getDownload: async (client, resource, { signal, range }) => {
      calls++;
      if (failure) throw new StudipError("download failed", failure);
      if (resource.remoteId.endsWith("-html"))
        return new Response("<script>alert('fixture')</script>", {
          headers: { "Content-Type": "text/html" },
        });
      if (resource.remoteId.endsWith("-zip"))
        return new Response(bytes, {
          headers: { "Content-Type": "application/zip" },
        });
      if (range === "bytes=0-1")
        return new Response(bytes.slice(0, 2), {
          status: 206,
          headers: {
            "Content-Range": "bytes 0-1/7",
            "Content-Length": "2",
            "Accept-Ranges": "bytes",
          },
        });
      if (range === "bytes=0-")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              signal.addEventListener(
                "abort",
                () => {
                  cancelled = true;
                  controller.error(new Error("cancelled"));
                },
                { once: true },
              );
            },
          }),
        );
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(bytes.length),
          "Set-Cookie": "PHPSESSID=private",
        },
      });
    },
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, cookie, body, headers = {}) =>
    fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function state(cookie) {
    return (await request("/api/state", cookie)).json();
  }
  async function login(username) {
    const response = await request("/api/auth/login", null, {
      username,
      password: "fixture",
    });
    const cookie = response.headers.getSetCookie()[0].split(";")[0];
    for (let i = 0; i < 50 && (await state(cookie)).syncing; i++)
      await new Promise((r) => setTimeout(r, 5));
    return cookie;
  }
  try {
    assert.equal((await request("/api/files/alice-ref/download")).status, 401);
    assert.equal((await request("/api/files/alice-ref/preview")).status, 401);
    assert.equal((await request("/api/files/alice-ref/content")).status, 401);
    const alice = await login("alice"),
      bob = await login("bob");
    assert.equal(
      (await request("/api/files/alice-ref/download", bob)).status,
      404,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await request("/api/files/alice-ref/preview", bob)).status,
      404,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await request("/api/files/alice-ref/content", bob)).status,
      404,
    );
    assert.equal(calls, 0);
    await request("/api/sync", alice, {});
    assert.equal((await state(alice)).changes[0].read, false);
    const thumbnail = await request("/api/files/alice-ref/content", alice);
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get("content-type"), "application/pdf");
    assert.match(thumbnail.headers.get("content-disposition"), /^inline;/);
    assert.deepEqual(new Uint8Array(await thumbnail.arrayBuffer()), bytes);
    assert.equal((await state(alice)).changes[0].read, false);
    const thumbnailRange = await request(
      "/api/files/alice-ref/content",
      alice,
      null,
      { Range: "bytes=0-1" },
    );
    assert.equal(thumbnailRange.status, 206);
    assert.equal(thumbnailRange.headers.get("content-range"), "bytes 0-1/7");
    assert.deepEqual(
      new Uint8Array(await thumbnailRange.arrayBuffer()),
      bytes.slice(0, 2),
    );
    assert.equal((await state(alice)).changes[0].read, false);
    const partial = await request("/api/files/alice-ref/preview", alice, null, {
      Range: "bytes=0-1",
    });
    assert.equal(partial.status, 206);
    assert.match(partial.headers.get("content-disposition"), /^inline;/);
    assert.equal(partial.headers.get("content-type"), "application/pdf");
    assert.equal(partial.headers.get("content-range"), "bytes 0-1/7");
    assert.deepEqual(
      new Uint8Array(await partial.arrayBuffer()),
      bytes.slice(0, 2),
    );
    assert.equal((await state(alice)).changes[0].read, false);
    assert.equal(calls, 1, "thumbnail and preview ranges reuse the full cached file");
    // Change the version so the cancellation below reaches the upstream stream.
    await request("/api/sync", alice, {});
    const interrupted = await request(
      "/api/files/alice-ref/download",
      alice,
      null,
      { Range: "bytes=0-" },
    );
    const reader = interrupted.body.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 50 && !cancelled; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(cancelled, true);
    assert.equal((await state(alice)).changes[0].read, false);
    const downloaded = await request("/api/files/alice-ref/download", alice);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
    assert.match(
      downloaded.headers.get("content-disposition"),
      /filename\*=UTF-8''/,
    );
    assert.equal(
      downloaded.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.ok(
      !downloaded.headers.getSetCookie().some((c) => c.includes("PHPSESSID")),
    );
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
    for (let i = 0; i < 50 && !(await state(alice)).changes[0].read; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await state(alice)).changes[0].read, true);
    await request("/api/sync", alice, {});
    assert.equal((await state(alice)).changes[0].read, false);
    const preview = await request("/api/files/alice-ref/preview", alice);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition"), /^inline;/);
    assert.equal(preview.headers.get("content-type"), "application/pdf");
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), bytes);
    for (let i = 0; i < 50 && !(await state(alice)).changes[0].read; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await state(alice)).changes[0].read, true);
    const htmlPreview = await request("/api/files/alice-html/preview", alice);
    assert.match(htmlPreview.headers.get("content-type"), /^text\/plain/);
    assert.equal(await htmlPreview.text(), "<script>alert('fixture')</script>");
    const zipPreview = await request("/api/files/alice-zip/preview", alice);
    assert.equal(zipPreview.status, 415);
    assert.equal(zipPreview.headers.get("content-disposition"), null);
    const zipPage = await zipPreview.text();
    assert.match(zipPage, /Браузер не поддерживает просмотр/);
    assert.match(zipPage, /href="\/api\/files\/alice-zip\/download"/);
    // A changed file must be fetched again, including upstream access failures.
    await request("/api/sync", alice, {});
    failure = 403;
    assert.equal(
      (await request("/api/files/alice-ref/download", alice)).status,
      403,
    );
    assert.equal((await state(alice)).authenticated, true);
    failure = 401;
    assert.equal(
      (await request("/api/files/alice-ref/download", alice)).status,
      401,
    );
    assert.equal((await state(alice)).authenticated, false);
    assert.equal((await state(bob)).authenticated, true);
    await request("/api/auth/logout", bob, {});
    assert.equal(
      (await request("/api/files/bob-ref/download", bob)).status,
      401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await instance.close();
    await rm(directory, { recursive: true });
  }
});

test("file routes share a persistent cache and invalidate it on changes or denied access", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-file-cache-"));
  let instance, server, base, calls = 0, version = 1, denied = false, removed = false;
  const owners = new WeakMap();
  async function start() {
    instance = await createApp({
      dataDir: directory,
      autoSync: false,
      authenticate: async (username) => ({
        user: { id: username, name: username }, jar: new CookieJar(),
      }),
      getSnapshot: async (client, user) => {
        owners.set(client, user.id);
        return {
          courses: [{ id: "course" }],
          resources: denied || removed ? [] : [{ ...file, mime: "application/pdf", updatedAt: version }],
          unavailableSources: denied ? [{ courseId: "course", kind: "file" }] : [],
        };
      },
      getDownload: async (client, resource) => {
        calls++;
        if (denied) throw new StudipError("Access denied", 403);
        return new Response(`${owners.get(client)}:${resource.updatedAt}`, { headers: { "Content-Type": "application/pdf" } });
      },
    });
    server = instance.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await instance.close();
  }
  const request = (route, cookie, body) => fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login(username) {
    const result = await request("/api/auth/login", null, { username, password: "fixture" });
    const cookie = result.headers.getSetCookie()[0].split(";")[0];
    for (let i = 0; i < 50; i++) {
      if (!(await (await request("/api/state", cookie)).json()).syncing) return cookie;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Sync timeout");
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  const alice = await login("alice"), bob = await login("bob");
  assert.equal(await (await request("/api/files/ref/content", alice)).text(), "alice:1");
  assert.equal(await (await request("/api/files/ref/preview", alice)).text(), "alice:1");
  assert.equal(await (await request("/api/files/ref/download", alice)).text(), "alice:1");
  assert.equal(calls, 1);
  assert.equal(await (await request("/api/files/ref/content", bob)).text(), "bob:1");
  assert.equal(calls, 2);
  await stop();
  await start();
  assert.equal(await (await request("/api/files/ref/content", alice)).text(), "alice:1");
  assert.equal(calls, 2, "cache and authenticated session survive a restart");
  version++;
  await (await request("/api/sync", alice, {})).json();
  assert.equal(await (await request("/api/files/ref/content", alice)).text(), "alice:2");
  assert.equal(calls, 3);
  denied = true;
  await (await request("/api/sync", alice, {})).json();
  assert.equal((await request("/api/files/ref/content", alice)).status, 403);
  assert.equal(calls, 4);
  denied = false;
  await (await request("/api/sync", alice, {})).json();
  assert.equal(await (await request("/api/files/ref/content", alice)).text(), "alice:2");
  assert.equal(calls, 5, "restored permissions require a fresh download");
  removed = true;
  await (await request("/api/sync", alice, {})).json();
  assert.equal((await request("/api/files/ref/content", alice)).status, 404);
  await (await request("/api/auth/logout", bob, {})).json();
  assert.equal((await request("/api/files/ref/content", bob)).status, 401);
});
