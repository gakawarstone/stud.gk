import test from "node:test";
import assert from "node:assert/strict";
import { FeedSession, SESSION_EXPIRED } from "./feed-session.ts";
import { ApiError } from "./api.ts";

const feed = (overrides = {}) => ({
  authenticated: true, mode: "live", courses: [], resources: [], changes: [],
  lastSync: "2026-10-19T12:00:00Z", syncing: false, error: null,
  user: { id: "fixture", name: "Fixture" }, ...overrides,
});
function harness() {
  const pending = [];
  let resets = 0;
  const session = new FeedSession({
    request: (url, body, signal) => new Promise((resolve, reject) => pending.push({ url, body, signal, resolve, reject })),
    onSignedOut: () => { resets++; },
  });
  return { session, pending, get resets() { return resets; } };
}

test("a late successful snapshot cannot restore an expired session", async () => {
  const h = harness();
  const old = h.session.load();
  const latest = h.session.load();
  assert.equal(h.pending[0].signal.aborted, true);
  h.pending[1].resolve({ authenticated: false, authExpired: true });
  await latest;
  assert.equal(h.session.getSnapshot().phase, "login");
  assert.equal(h.session.getSnapshot().error, SESSION_EXPIRED);
  // Some transports can still complete after cancellation. Ignore their result.
  h.pending[0].resolve(feed());
  await old;
  assert.equal(h.session.getSnapshot().data, null);
  assert.equal(h.session.getSnapshot().phase, "login");
  assert.equal(h.resets, 1);
});

test("stale failures and unauthenticated responses cannot replace a newer snapshot", async () => {
  for (const failure of [false, true]) {
    const h = harness();
    const old = h.session.load(), latest = h.session.load();
    h.pending[1].resolve(feed());
    await latest;
    if (failure) h.pending[0].reject(new ApiError("expired", 401));
    else h.pending[0].resolve({ authenticated: false, authExpired: true });
    await old;
    assert.equal(h.session.getSnapshot().phase, "live");
    assert.equal(h.session.getSnapshot().error, null);
    assert.equal(h.resets, 0);
  }
});

test("initial anonymous state preserves deep links, expiry resets the workspace", async () => {
  const h = harness();
  const initial = h.session.load();
  h.pending[0].resolve({ authenticated: false, authExpired: false });
  await initial;
  assert.equal(h.resets, 0);
  const retry = h.session.load();
  h.pending[1].reject(new ApiError("expired", 401));
  await retry;
  assert.equal(h.resets, 1);
  assert.equal(h.session.getSnapshot().error, SESSION_EXPIRED);
});

test("logout blocks polling and invalidates in-flight snapshots", async () => {
  const h = harness();
  const initial = h.session.load(); h.pending[0].resolve(feed()); await initial;
  const old = h.session.load(), logout = h.session.logout();
  await h.session.load();
  assert.equal(h.pending.length, 3);
  assert.equal(h.pending[2].url, "/api/auth/logout");
  h.pending[2].resolve({ ok: true }); await logout;
  h.pending[1].resolve(feed()); await old;
  assert.deepEqual(h.session.getSnapshot(), { phase: "login", data: null, busy: false, error: null });
});

test("switching to demo ignores an older login completion and its errors", async () => {
  for (const failure of [false, true]) {
    const h = harness();
    const login = h.session.login("fixture", "password");
    const demo = h.session.showDemo();
    assert.equal(h.pending[1].url, "/api/demo");
    h.pending[1].resolve(feed({ authenticated: false, mode: "demo", user: null })); await demo;
    if (failure) h.pending[0].reject(new Error("old login failed"));
    else h.pending[0].resolve({ ok: true });
    await login;
    assert.equal(h.session.getSnapshot().phase, "demo");
    assert.equal(h.session.getSnapshot().busy, false);
    assert.equal(h.session.getSnapshot().error, null);
    assert.equal(h.pending.length, 2);
  }
});

test("login loads the authenticated account and a failed logout keeps it available", async () => {
  const h = harness();
  const login = h.session.login("fixture", "password");
  h.pending[0].resolve({ ok: true });
  await Promise.resolve();
  assert.equal(h.pending[1].url, "/api/state");
  h.pending[1].resolve(feed()); await login;
  assert.equal(h.session.getSnapshot().phase, "live");
  assert.equal(h.session.getSnapshot().busy, false);
  const logout = h.session.logout();
  h.pending[2].reject(new Error("offline")); await logout;
  assert.equal(h.session.getSnapshot().phase, "live");
  assert.equal(h.session.getSnapshot().error, "offline");
  assert.equal(h.session.getSnapshot().busy, false);
});

test("a pending poll cannot undo read marks or a saved GitLab project", async () => {
  const h = harness();
  const change = { id: "change", resourceId: "file", read: false };
  const initial = h.session.load(); h.pending[0].resolve(feed({ changes: [change] })); await initial;
  const old = h.session.load(), read = h.session.markResourceViewed("file");
  h.pending[2].resolve({ ok: true }); await read;
  h.pending[1].resolve(feed({ changes: [change] })); await old;
  assert.equal(h.session.getSnapshot().data.changes[0].read, true);
  const stale = h.session.load(), save = h.session.saveGitlabProject("c1", "https://gitlab.com/team/project");
  h.pending[4].resolve({ projects: [{ id: "p1", url: "https://gitlab.com/team/project" }] }); await save;
  h.pending[3].resolve(feed()); await stale;
  assert.equal(h.session.getSnapshot().data.gitlabProjects.c1[0].url, "https://gitlab.com/team/project");
});

test("refresh expiry clears data and a read completion cannot cross a session boundary", async () => {
  const h = harness();
  const initial = h.session.load();
  h.pending[0].resolve(feed({ changes: [{ id: "change", resourceId: "file", read: false }] })); await initial;
  const read = h.session.markResourceViewed("file"), refresh = h.session.refresh();
  h.pending[2].reject(new ApiError("expired", 401)); await refresh;
  h.pending[1].resolve({ ok: true }); await read;
  assert.equal(h.session.getSnapshot().data, null);
  assert.equal(h.session.getSnapshot().busy, false);
  assert.equal(h.resets, 1);
});

test("unmount ignores pending work and allows a subsequent effect setup", async () => {
  const h = harness();
  const old = h.session.load();
  h.session.dispose();
  h.pending[0].resolve(feed()); await old;
  assert.equal(h.session.getSnapshot().phase, "loading");
  const current = h.session.load(); h.pending[1].resolve(feed()); await current;
  assert.equal(h.session.getSnapshot().phase, "live");
});


test("GitLab edits and removals update the course list using the selected project ID", async () => {
  const h = harness();
  const first = { id: "p1", url: "https://gitlab.com/team/materials" };
  const second = { id: "p2", url: "https://gitlab.example/team/exercises" };
  const initial = h.session.load();
  h.pending[0].resolve(feed({ gitlabProjects: { c1: [first, second] } })); await initial;
  const edited = { ...second, url: "https://gitlab.example/team/solutions" };
  const edit = h.session.saveGitlabProject("c1", edited.url, second.id);
  assert.equal(h.pending[1].url, "/api/courses/c1/gitlab/projects/p2");
  assert.deepEqual(h.pending[1].body, { url: edited.url });
  h.pending[1].resolve({ project: edited, projects: [first, edited] });
  assert.deepEqual(await edit, [first, edited]);
  const remove = h.session.saveGitlabProject("c1", null, second.id);
  assert.equal(h.pending[2].url, "/api/courses/c1/gitlab/projects/p2");
  h.pending[2].resolve({ project: null, projects: [first] }); await remove;
  assert.deepEqual(h.session.getSnapshot().data.gitlabProjects.c1, [first]);
  const last = h.session.saveGitlabProject("c1", null, first.id);
  h.pending[3].resolve({ project: null, projects: [] }); await last;
  assert.deepEqual(h.session.getSnapshot().data.gitlabProjects, {});
});
