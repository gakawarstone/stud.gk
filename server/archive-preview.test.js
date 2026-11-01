import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { archiveContents, archivePage, ARCHIVE_LIMIT, ENTRY_LIMIT } from "./archive-preview.js";
import { createApp } from "./app.js";

const zip = await readFile(new URL("../scripts/fixtures/archive-preview.zip", import.meta.url));
test("lists ZIP central-directory metadata without extracting members", async () => {
  const result = await archiveContents(new Response(zip));
  assert.equal(result.total, 9);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.entries[0], { name: "Demos_V3/", size: 0, directory: true });
  assert.equal(result.entries[1].name, "Demos_V3/README.md");
  assert.equal(result.entries[1].size, 14);
  const empty = Buffer.alloc(22);
  empty.writeUInt32LE(0x06054b50);
  assert.equal((await archiveContents(new Response(empty))).total, 0);
  // Repeat central-directory records to exercise the entry cap without decompression.
  const start = zip.readUInt32LE(zip.length - 6);
  const length = 46 + zip.readUInt16LE(start + 28) + zip.readUInt16LE(start + 30) + zip.readUInt16LE(start + 32);
  const central = Buffer.concat(Array(ENTRY_LIMIT + 1).fill(zip.subarray(start, start + length)));
  const end = Buffer.from(empty);
  end.writeUInt16LE(ENTRY_LIMIT + 1, 8); end.writeUInt16LE(ENTRY_LIMIT + 1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(start, 16);
  const bounded = await archiveContents(new Response(Buffer.concat([zip.subarray(0, start), central, end])));
  assert.equal(bounded.entries.length, ENTRY_LIMIT);
  assert.equal(bounded.truncated, true);
});
test("rejects broken and oversized archives and escapes HTML names", async () => {
  await assert.rejects(archiveContents(new Response("not zip")), e => e.status === 415);
  await assert.rejects(archiveContents(new Response("", { headers: { "content-length": String(ARCHIVE_LIMIT + 1) } })), e => e.status === 413);
  await assert.rejects(archiveContents(new Response(new Uint8Array(ARCHIVE_LIMIT + 1))), e => e.status === 413);
  const page = archivePage({ title: '<script>alert(1)</script>.zip', remoteId: 'ref' }, { entries: [{ name: '<img onerror="evil()">', size: 1, directory: false }], total: 1, truncated: false });
  assert.ok(!page.includes('<script>'));
  assert.ok(page.includes('&lt;img'));
});
test("archive routes require ownership, preserve download bytes, and ignore ranges for listings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "archive-test-"));
  let range;
  const instance = await createApp({ dataDir: directory, autoSync: false,
    authenticate: async username => ({ user: { id: username, name: username }, jar: new CookieJar() }),
    getSnapshot: async (_client, user) => ({ courses: [{ id: user.id, title: 'Course' }], resources: [{ id: user.id, remoteId: user.id, courseId: user.id, kind: 'file', title: 'Demos_V3.zip' }] }),
    getDownload: async (_client, _file, options) => { range = options.range; return new Response(zip, { headers: { 'content-type': 'application/zip' } }); },
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/files/alice/contents')).status, 401);
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'fixture' }) });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const headers = { Cookie: cookie };
    for (let i = 0; i < 100; i++) {
      const state = await (await fetch(base + '/api/state', { headers })).json();
      if (!state.syncing && state.resources?.length) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await fetch(base + '/api/files/bob/contents', { headers })).status, 404);
    const result = await fetch(base + '/api/files/alice/contents', { headers: { ...headers, Range: 'bytes=0-5' } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).total, 9);
    assert.equal(range, undefined);
    const preview = await fetch(base + '/api/files/alice/preview', { headers });
    assert.equal(preview.status, 200);
    assert.ok((await preview.text()).includes('Demos_V3/README.md'));
    const download = await fetch(base + '/api/files/alice/download', { headers });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), zip);
    assert.match(download.headers.get('content-disposition'), /^attachment/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});
