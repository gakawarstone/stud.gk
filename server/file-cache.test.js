import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileCache } from "./file-cache.js";

const file = { id: "file:course:ref", remoteId: "ref", kind: "file", title: "notes.txt", updatedAt: 1 };
async function fixture(t, options) {
  const directory = await mkdtemp(path.join(tmpdir(), "studip-cache-"));
  const cache = await createFileCache(directory, options);
  t.after(async () => {
    await cache.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { cache, directory };
}

test("cache persists complete files, isolates accounts and serves byte ranges", async (t) => {
  const { cache, directory } = await fixture(t);
  let calls = 0;
  const load = async () => {
    calls++;
    return new Response("abcdef", { headers: { "Content-Type": "text/plain", "Content-Length": "6", "Set-Cookie": "secret" } });
  };
  assert.equal(await (await cache.download("alice", file, load)).text(), "abcdef");
  const range = await cache.download("alice", file, load, { range: "bytes=2-99" });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-5/6");
  assert.equal(range.headers.get("content-length"), "4");
  assert.equal(range.headers.get("set-cookie"), null);
  assert.equal(await range.text(), "cdef");
  assert.equal(await (await cache.download("alice", file, load, { range: "bytes=3-" })).text(), "def");
  assert.equal(calls, 1);
  await (await cache.download("bob", file, load)).text();
  assert.equal(calls, 2);
  const restored = await createFileCache(directory);
  assert.equal(await (await restored.download("alice", file, load)).text(), "abcdef");
  assert.equal(calls, 2);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const name of await readdir(directory))
    assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o600);
});

test("changed and removed files discard old cached versions, including in-flight writes", async (t) => {
  const { cache, directory } = await fixture(t);
  let calls = 0;
  const load = async () => new Response(String(++calls));
  await cache.prune("alice", [file]);
  assert.equal(await (await cache.download("alice", file, load)).text(), "1");
  const updated = { ...file, updatedAt: 2 };
  await cache.prune("alice", [updated]);
  assert.deepEqual(await readdir(directory), []);
  const response = await cache.download("alice", updated, load);
  await cache.prune("alice", []);
  assert.equal(await response.text(), "2");
  assert.deepEqual(await readdir(directory), []);
});

test("cache evicts least recently used files and bypasses oversized files", async (t) => {
  const { cache, directory } = await fixture(t, { maxBytes: 6 });
  let calls = 0;
  const load = async () => { calls++; return new Response("abc"); };
  const second = { ...file, remoteId: "second" }, third = { ...file, remoteId: "third" };
  await (await cache.download("alice", file, load)).text();
  await (await cache.download("alice", second, load)).text();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await (await cache.download("alice", file, load)).text();
  await (await cache.download("alice", third, load)).text();
  assert.equal(calls, 3);
  await (await cache.download("alice", file, load)).text();
  assert.equal(calls, 3);
  await (await cache.download("alice", second, load)).text();
  assert.equal(calls, 4);
  const large = { ...file, remoteId: "large" };
  for (let i = 0; i < 2; i++)
    assert.equal(await (await cache.download("alice", large, async () => { calls++; return new Response("too large"); })).text(), "too large");
  assert.equal(calls, 6);
  const sizes = await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".bin")).map(async (name) => (await stat(path.join(directory, name))).size));
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= 6);
});

test("partial, truncated and failed streams never populate the cache", async (t) => {
  const { cache, directory } = await fixture(t);
  for (const load of [
    async () => new Response("partial", { status: 206 }),
    async () => new Response("short", { headers: { "Content-Length": "50" } }),
    async () => new Response("encoded", { headers: { "Content-Encoding": "gzip" } }),
  ]) {
    await (await cache.download("alice", file, load)).text();
    assert.deepEqual(await readdir(directory), []);
  }
  const broken = await cache.download("alice", file, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("start")); },
    pull(controller) { controller.error(new Error("upstream disconnected")); },
  })));
  await assert.rejects(broken.text(), /upstream disconnected/);
  assert.deepEqual(await readdir(directory), []);
  let cancelled = false;
  const interrupted = await cache.download("alice", file, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(100)); },
    cancel() { cancelled = true; },
  })));
  const reader = interrupted.body.getReader();
  await reader.read();
  await reader.cancel();
  for (let i = 0; i < 50 && (await readdir(directory)).length; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cancelled, true);
  assert.deepEqual(await readdir(directory), []);
});

test("missing payloads and leftovers after a restart are discarded", async (t) => {
  const { cache, directory } = await fixture(t);
  const load = async () => new Response("fresh");
  await (await cache.download("alice", file, load)).text();
  const payload = (await readdir(directory)).find((name) => name.endsWith(".bin"));
  await rm(path.join(directory, payload));
  assert.equal(await (await cache.download("alice", file, load)).text(), "fresh");
  await writeFile(path.join(directory, "interrupted.tmp"), "incomplete");
  await writeFile(path.join(directory, `${"a".repeat(64)}.bin`), "orphan");
  await createFileCache(directory);
  assert.equal((await readdir(directory)).length, 2);
});

test("empty files are reusable and unavailable cache storage still allows downloads", async (t) => {
  const { cache, directory } = await fixture(t);
  let calls = 0;
  const load = async () => { calls++; return new Response(""); };
  assert.equal(await (await cache.download("alice", file, load)).text(), "");
  const hit = await cache.download("alice", file, load);
  assert.equal(hit.headers.get("content-length"), "0");
  assert.equal(await hit.text(), "");
  assert.equal(calls, 1);
  await rm(directory, { recursive: true });
  await writeFile(directory, "storage is unavailable");
  assert.equal(await (await cache.download("alice", file, async () => new Response("uncached"))).text(), "uncached");
});
