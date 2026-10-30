import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { createApp } from "./app.js";
import { EncryptedSessionStore, SESSION_LIFETIME } from "./sessions.js";
import { openGitlabTokens } from "./gitlab-tokens.js";
import { readEncryptedJson } from "./encrypted-json.js";
import { StudipError } from "./studip.js";
import { call } from "./session-calls.js";

test("GitLab tokens survive login rotation, lost cookies, logout and expired Stud.IP sessions", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "stud-gk-account-tokens-"));
  let instance, server, base, rejectStudip = false;
  const project = "/api/courses/course/gitlab";
  const tokenRoute = `${project}/token`;
  const secret = "alice-private-gitlab-token";
  let expectedToken = secret;
  async function start() {
    instance = await createApp({
      dataDir: directory, autoSync: false,
      authenticate: async (username) => ({ user: { id: username, name: username }, jar: new CookieJar() }),
      getSnapshot: async () => {
        if (rejectStudip) throw new StudipError("Stud.IP session expired", 401);
        return { courses: [{ id: "course", title: "Course" }], resources: [] };
      },
      getGitlabReadme: async (_url, { token }) => {
        assert.equal(token, expectedToken);
        return { branch: "main", readme: null };
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
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, cookie, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(),
      cookie: response.headers.getSetCookie().find((value) => value.startsWith("campus.sid="))?.split(";")[0] };
  }
  async function login(username, previousCookie) {
    const result = await request("/api/auth/login", previousCookie, { username, password: "test" });
    assert.equal(result.status, 200);
    for (let i = 0; i < 100; i++) {
      if (!(await request("/api/state", result.cookie)).data.syncing) return result.cookie;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("sync timeout");
  }
  async function connected(cookie, expected) {
    const result = await request(tokenRoute, cookie);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { connected: expected });
    if (expected) assert.equal((await request(`${project}/readme`, cookie)).status, 200);
  }

  await start();
  let alice = await login("alice");
  await request(project, alice, { url: "https://gitlab.example/group/project" });
  assert.equal((await request(tokenRoute, alice, { token: secret })).status, 200);
  await stop(); await start();
  await connected(alice, true);

  const oldAlice = alice;
  alice = await login("alice", alice);
  assert.notEqual(alice, oldAlice);
  assert.equal((await request(tokenRoute, oldAlice)).status, 401);
  await connected(alice, true);
  const otherAlice = await login("alice");
  await connected(otherAlice, true);

  // Changing identity with the same browser must not copy the previous user's token.
  const bob = await login("bob", alice);
  await request(project, bob, { url: "https://gitlab.example/group/project" });
  await connected(bob, false);
  await connected(otherAlice, true);

  await request("/api/auth/logout", otherAlice, {});
  assert.equal((await request(tokenRoute, otherAlice)).status, 401);
  alice = await login("alice");
  await connected(alice, true);

  // Advance only the local store clock so no wall-clock waiting is needed.
  instance.store.now = () => Date.now() + SESSION_LIFETIME + 1;
  assert.equal((await request(tokenRoute, alice)).status, 401);
  instance.store.now = Date.now;
  alice = await login("alice", alice);
  await connected(alice, true);

  rejectStudip = true;
  assert.equal((await request("/api/sync", alice, {})).status, 401);
  rejectStudip = false;
  alice = await login("alice", alice);
  await connected(alice, true);

  const concurrentAlice = await login("alice");
  expectedToken = "alice-replacement-token";
  assert.equal((await request(tokenRoute, alice, { token: expectedToken })).status, 200);
  await connected(concurrentAlice, true);
  assert.equal((await request(tokenRoute, alice, { token: null })).status, 200);
  await connected(concurrentAlice, false);
  await stop(); await start();
  alice = await login("alice");
  await connected(alice, false);
});

test("legacy GitLab tokens migrate before expired sessions are discarded and cannot reappear after deletion", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "stud-gk-token-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origin = "https://gitlab.example";
  let sessions = await EncryptedSessionStore.open(directory);
  async function legacy(id, userId, token, expiresAt) {
    await call(sessions, "set", id, {
      auth: { user: { id: userId, name: userId }, jar: new CookieJar().toJSON(), expiresAt },
      gitlabTokens: { [origin]: token },
    });
  }
  // Insert out of login order to verify the newer login wins.
  await legacy("alice-new", "alice", "alice-new-token", Date.now() - 1000);
  await legacy("alice-old", "alice", "alice-old-token", Date.now() - 2000);
  await legacy("bob", "bob", "bob-token", Date.now() + SESSION_LIFETIME);
  sessions = await EncryptedSessionStore.open(directory);
  let tokens = await openGitlabTokens(directory, sessions);
  assert.equal(tokens.get("alice", origin), "alice-new-token");
  assert.equal(tokens.get("bob", origin), "bob-token");
  assert.equal(await call(sessions, "get", "alice-new"), null);
  await sessions.queue;
  sessions = await EncryptedSessionStore.open(directory);
  assert.ok(Object.values(sessions.entries).every(({ value }) => !value.gitlabTokens));

  await tokens.set("alice", origin, "replacement-token");
  await legacy("stale-copy", "alice", "alice-old-token", Date.now() + SESSION_LIFETIME);
  tokens = await openGitlabTokens(directory, sessions);
  assert.equal(tokens.get("alice", origin), "replacement-token");
  await tokens.set("alice", origin, null);
  sessions = await EncryptedSessionStore.open(directory);
  tokens = await openGitlabTokens(directory, sessions);
  assert.equal(tokens.get("alice", origin), undefined);
  assert.equal(tokens.get("bob", origin), "bob-token");
});

test("account tokens are encrypted, scoped, serialized and committed only after a successful write", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "stud-gk-token-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessions = await EncryptedSessionStore.open(directory);
  let tokens = await openGitlabTokens(directory, sessions);
  const filename = path.join(directory, "gitlab-tokens.enc");
  const origin = "https://gitlab.example";
  await Promise.all([
    tokens.set("alice", origin, "alice-private-token"),
    tokens.set("bob", origin, "bob-private-token"),
    tokens.set("alice", "https://another.example:8443", "other-host-token"),
    tokens.set("__proto__", origin, "unusual-user-token"),
  ]);
  tokens = await openGitlabTokens(directory, sessions);
  assert.equal(tokens.get("alice", origin), "alice-private-token");
  assert.equal(tokens.get("bob", origin), "bob-private-token");
  assert.equal(tokens.get("alice", "https://another.example:8443"), "other-host-token");
  assert.equal(tokens.get("alice", "https://another.example"), undefined);
  assert.equal(tokens.get("__proto__", origin), "unusual-user-token");
  assert.equal(tokens.get("constructor", origin), undefined);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const encrypted = await readFile(filename, "utf8");
  assert.ok(!encrypted.includes("alice-private-token"));
  await assert.rejects(readEncryptedJson(filename, sessions.key));

  await mkdir(`${filename}.tmp`);
  await assert.rejects(tokens.set("alice", origin, "failed-replacement"));
  assert.equal(tokens.get("alice", origin), "alice-private-token");
  await rm(`${filename}.tmp`, { recursive: true });
  await tokens.set("alice", origin, "replacement-token");
  tokens = await openGitlabTokens(directory, sessions);
  assert.equal(tokens.get("alice", origin), "replacement-token");

  const envelope = JSON.parse(await readFile(filename, "utf8"));
  const data = Buffer.from(envelope.data, "base64");
  data[0] ^= 1;
  const tampered = JSON.stringify({ ...envelope, data: data.toString("base64") });
  await writeFile(filename, tampered);
  await assert.rejects(openGitlabTokens(directory, sessions), /Cannot decrypt saved GitLab tokens/);
  assert.equal(await readFile(filename, "utf8"), tampered);
});
