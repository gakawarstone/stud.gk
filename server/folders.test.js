import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { createApp } from "./app.js";
import { BASE, createClient, fetchCourseFolders, StudipError } from "./studip.js";

test("folder discovery consumes every page and preserves parent and file relationships", async () => {
  const paths = [];
  const client = createClient("session=test", async (url, options) => {
    paths.push(url.href);
    assert.equal(options.method, "GET");
    let data;
    let links = {};
    if (url.pathname.endsWith("/folders")) {
      if (url.searchParams.has("page[offset]")) data = [{
        id: "nested", attributes: { name: "<b>Aufgaben</b>", "is-readable": false },
        relationships: { parent: { data: { id: "root" } } },
      }];
      else {
        data = [{ id: "root", attributes: { name: "Dateien" }, relationships: { parent: { data: null } } }];
        links.next = "courses/c1/folders?page[offset]=1";
      }
    } else data = [{ id: "f1", relationships: { parent: { data: { id: "nested" } } } }];
    return Response.json({ data, links });
  });
  const result = await fetchCourseFolders(client, "c1");
  assert.equal(paths.length, 3);
  assert.equal(result.rootId, "root");
  assert.deepEqual(result.folders[1], { id: "nested", title: "Aufgaben", parentId: "root", readable: false });
  assert.deepEqual(result.fileFolders, [{ fileRefId: "f1", folderId: "nested" }]);
  await assert.rejects(fetchCourseFolders({ list: async () => {
    throw new StudipError("Denied", 403);
  } }, "c1"), (error) => error.status === 403);
});

test("folder API requires the account's course and does not change file history", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "stud-gk-folders-"));
  let calls = 0;
  let failure = null;
  const instance = await createApp({
    dataDir: directory,
    autoSync: false,
    authenticate: async (username) => {
      const jar = new CookieJar();
      await jar.setCookie(`PHPSESSID=test-${username}; Path=/; Secure; HttpOnly`, BASE);
      return { jar, user: { id: username, name: username } };
    },
    getSnapshot: async (_, user) => ({
      courses: [{ id: `${user.id}-course`, title: "Course" }],
      resources: [{ id: `${user.id}-file`, remoteId: `${user.id}-ref`, kind: "file", courseId: `${user.id}-course`, title: "Notes.pdf" }],
    }),
    getFolders: async () => {
      calls++;
      if (failure) throw failure;
      return { rootId: "root", folders: [{ id: "root", parentId: null, title: "Files", readable: true }],
        fileFolders: [{ fileRefId: "alice-ref", folderId: "root" }, { fileRefId: "other-account-ref", folderId: "root" }] };
    },
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, cookie) => fetch(base + route, { headers: cookie ? { Cookie: cookie } : {} });
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "alice", password: "test" }),
  });
  const cookie = login.headers.getSetCookie().find((value) => value.startsWith("campus.sid=")).split(";")[0];
  let before;
  for (let i = 0; i < 50; i++) {
    before = await (await request("/api/state", cookie)).json();
    if (!before.syncing) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal((await request("/api/courses/alice-course/folders")).status, 401);
  assert.equal((await request("/api/courses/bob-course/folders", cookie)).status, 404);
  assert.equal(calls, 0);
  const result = await request("/api/courses/alice-course/folders", cookie);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).fileFolders, [{ fileRefId: "alice-ref", folderId: "root" }]);
  assert.deepEqual(await (await request("/api/state", cookie)).json(), before);
  failure = new StudipError("Folders unavailable", 403);
  assert.equal((await request("/api/courses/alice-course/folders", cookie)).status, 403);
  assert.deepEqual(await (await request("/api/state", cookie)).json(), before);
  failure = new StudipError("Expired", 401);
  assert.equal((await request("/api/courses/alice-course/folders", cookie)).status, 401);
  assert.equal((await (await request("/api/state", cookie)).json()).authenticated, false);
  const demo = await request("/api/demo/courses/web/folders");
  assert.equal(demo.status, 200);
  assert.ok((await demo.json()).folders.some((folder) => folder.parentId === "demo-exercises-web"));
});
