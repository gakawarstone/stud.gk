import test from "node:test";
import assert from "node:assert/strict";
import {
  apiUrl,
  createClient,
  fetchSnapshot,
  normalize,
  StudipError,
} from "./studip.js";
import { reconcile } from "./changes.js";

const response = (data, links = {}) =>
  new Response(JSON.stringify({ data, links }), { status: 200 });
const item = {
  id: "f1",
  title: "notes.pdf",
  kind: "file",
  courseId: "c1",
  size: 100,
};
const snapshot = (resources) => ({ courses: [], resources, semester: "WS" });

test("first successful sync is a baseline, not a flood of new notifications", () => {
  const state = reconcile(null, snapshot([item]), "2026-10-02T12:00:00Z");
  assert.deepEqual(state.changes, []);
  assert.equal(state.resources.length, 1);
});
test("detects additions, edits and removals while preserving read and favorite state", () => {
  const previous = {
    ...snapshot([item, { ...item, id: "f2" }]),
    changes: [{ id: "old", read: true, starred: true }],
  };
  const next = reconcile(
    previous,
    snapshot([
      { ...item, size: 200 },
      { ...item, id: "f3" },
    ]),
  );
  assert.deepEqual(
    next.changes.slice(0, 3).map((c) => c.action),
    ["updated", "added", "removed"],
  );
  assert.equal(next.changes[0].before.size, 100);
  assert.deepEqual(next.changes.at(-1), previous.changes[0]);
  assert.equal(next.changes[0].read, false);
  assert.equal(reconcile(next, snapshot(next.resources)).changes.length, 4);
});
test("download counts and permissions do not produce file change notifications", () => {
  const raw = {
    id: "1",
    attributes: {
      name: "file.pdf",
      filesize: 100,
      downloads: 1,
      "is-writable": true,
    },
  };
  const first = normalize(raw, "file", "c1");
  const second = normalize(
    {
      ...raw,
      attributes: { ...raw.attributes, downloads: 5, "is-writable": false },
    },
    "file",
    "c1",
  );
  assert.deepEqual(first, second);
});
test("rejects pagination URLs that could leak a session", () => {
  for (const url of [
    "https://attacker.example/jsonapi.php/v1/users",
    "//attacker.example/foo",
    "/dispatch.php/start",
    "https://user:password@elearning.hs-flensburg.de/jsonapi.php/v1/users",
  ]) {
    assert.throws(() => apiUrl(url));
  }
  assert.equal(
    apiUrl("/jsonapi.php/v1/semesters?page[offset]=2").origin,
    "https://elearning.hs-flensburg.de",
  );
});
test("upstream requests are GET-only, use JSON:API accept and refuse redirects", async () => {
  const calls = [];
  const client = createClient("session=test", async (url, options) => {
    calls.push({ url, options });
    return response({ id: "u1" });
  });
  await client.get("users/me");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Accept, "application/vnd.api+json");
  assert.equal(calls[0].options.redirect, "error");
});
test("consumes all pages and catches pagination loops", async () => {
  let count = 0;
  const client = createClient("session=test", async () =>
    ++count === 1
      ? response([{ id: "1" }], {
          next: "/jsonapi.php/v1/files?page[offset]=1",
        })
      : response([{ id: "2" }]),
  );
  assert.equal((await client.list("files")).length, 2);
  const loop = createClient("session=test", async () =>
    response([], { next: "/jsonapi.php/v1/files" }),
  );
  await assert.rejects(loop.list("files"), /полностью/);
});
test("expired sessions and incomplete responses fail instead of creating empty snapshots", async () => {
  const expired = createClient(
    "session=test",
    async () => new Response("", { status: 401 }),
  );
  await assert.rejects(
    expired.get("users/me"),
    (error) => error.status === 401,
  );
  const malformed = createClient(
    "session=test",
    async () => new Response("{}"),
  );
  await assert.rejects(malformed.list("courses"), /Некорректный/);
  const failed = {
    list: async (path) => {
      if (path.startsWith("semesters"))
        return [{ id: "s1", attributes: { "is-current": true, title: "WS" } }];
      if (path.startsWith("users/"))
        return [{ id: "c1", attributes: { title: "Course" } }];
      throw new Error("upstream unavailable");
    },
  };
  await assert.rejects(
    fetchSnapshot(failed, { id: "u1" }),
    /upstream unavailable/,
  );
});
test("current semester and all course material routes are read through complete lists", async () => {
  const paths = [];
  const client = {
    list: async (path) => {
      paths.push(path);
      if (path.startsWith("semesters"))
        return [
          { id: "s1", attributes: { "is-current": true, title: "WS 2026/27" } },
        ];
      if (path.startsWith("users/"))
        return [{ id: "c1", attributes: { title: "Web" } }];
      if (path.includes("/file-refs"))
        return [
          { id: "f1", attributes: { name: "Lecture.pdf", filesize: 420 } },
        ];
      return [];
    },
  };
  const result = await fetchSnapshot(client, { id: "u1" });
  assert.match(paths[1], /filter\[semester\]=s1/);
  assert.equal(
    result.resources.find((r) => r.kind === "file").title,
    "Lecture.pdf",
  );
  assert.ok(paths.some((p) => p.includes("/news")));
  assert.ok(paths.some((p) => p.includes("/events")));
});

test("denied sections do not block accessible materials or leak partial pages", async () => {
  const paths = [];
  const client = createClient("session=test", async (url) => {
    const p = url.pathname;
    paths.push(p);
    if (p.endsWith("/semesters")) return response([]);
    if (p.endsWith("/users/u1/courses"))
      return response([{ id: "c1" }, { id: "c2" }]);
    if (p.endsWith("/c1/file-refs")) {
      if (url.searchParams.has("page[offset]"))
        return new Response("", { status: 403 });
      return response([{ id: "incomplete" }], {
        next: "courses/c1/file-refs?page[offset]=1",
      });
    }
    if (p.endsWith("/c2/news")) return new Response("", { status: 403 });
    if (p.endsWith("/c2/file-refs"))
      return response([{ id: "f2", attributes: { name: "Readable.pdf" } }]);
    return response([]);
  });
  const result = await fetchSnapshot(client, { id: "u1" });
  assert.deepEqual(result.unavailableSources, [
    { courseId: "c1", kind: "file" },
    { courseId: "c2", kind: "news" },
  ]);
  assert.equal(result.resources.filter((r) => r.kind === "file").length, 1);
  assert.equal(result.resources.find((r) => r.kind === "file").remoteId, "f2");
  assert.ok(paths.some((p) => p.endsWith("/c2/events")));
  for (const status of [401, 500]) {
    await assert.rejects(
      fetchSnapshot(
        {
          list: async (path) => {
            if (path.startsWith("semesters")) return [];
            if (path.startsWith("users/")) return [{ id: "c1" }];
            throw new StudipError("upstream failure", status);
          },
        },
        { id: "u1" },
      ),
      (e) => e.status === status,
    );
  }
  await assert.rejects(
    fetchSnapshot(
      {
        list: async () => {
          throw new StudipError("course discovery denied", 403);
        },
      },
      { id: "u1" },
    ),
    (e) => e.status === 403,
  );
});

test("permission gaps preserve cached materials and rebaseline only the recovering section", () => {
  const readable = { ...item, id: "f2", courseId: "c2" };
  const original = reconcile(null, snapshot([item, readable]));
  const denied = reconcile(original, {
    ...snapshot([{ ...readable, size: 200 }]),
    unavailableSources: [{ courseId: "c1", kind: "file" }],
  });
  assert.deepEqual(
    denied.resources.find((r) => r.id === "f1"),
    item,
  );
  assert.equal(denied.changes.length, 1);
  assert.equal(denied.changes[0].courseId, "c2");
  const restoredFile = { ...item, id: "replacement", size: 300 };
  const restored = reconcile(denied, {
    ...snapshot([restoredFile, { ...readable, size: 400 }]),
    unavailableSources: [],
  });
  assert.equal(restored.changes.length, 2);
  assert.ok(restored.changes.every((c) => c.courseId === "c2"));
  assert.equal(
    restored.resources.some((r) => r.id === "f1"),
    false,
  );
  const updated = reconcile(
    restored,
    snapshot([
      { ...restoredFile, size: 500 },
      { ...readable, size: 400 },
    ]),
  );
  assert.equal(updated.changes[0].action, "updated");
  assert.equal(updated.changes[0].courseId, "c1");
  const firstDenied = reconcile(null, {
    ...snapshot([]),
    unavailableSources: [{ courseId: "c1", kind: "file" }],
  });
  assert.equal(reconcile(firstDenied, snapshot([item])).changes.length, 0);
});
