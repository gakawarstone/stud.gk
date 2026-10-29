import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { createApp } from "./app.js";
import { normalizeGitlabProject } from "./gitlab.js";
import { GitlabError } from "./gitlab-client.js";

test("GitLab links support nested namespaces and self-hosted instances", () => {
  assert.deepEqual(normalizeGitlabProject(" https://gitlab.com/team/subgroup/project.git/?ref=share#readme "), {
    url: "https://gitlab.com/team/subgroup/project",
  });
  assert.deepEqual(normalizeGitlabProject("https://code.university.example:8443/class/project"), {
    url: "https://code.university.example:8443/class/project",
  });
  for (const value of [undefined, null, {}, 123, "", "git@gitlab.com:team/project.git",
    "javascript:alert(1)", "file:///team/project", "https://user:secret@gitlab.com/team/project",
    "https://gitlab.com", "https://gitlab.com/team", "https://gitlab.com/team//project",
    "https://gitlab.com/team/project/-/tree/main", "https://gitlab.com/team/%2fproject",
    `https://gitlab.com/team/${"a".repeat(2048)}`]) {
    assert.throws(() => normalizeGitlabProject(value), /GitLab project URL/);
  }
});

test("course project links are private, persist across sync and restart, and can be replaced or removed", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "stud-gk-gitlab-"));
  let instance, server, base;
  let releaseSnapshot;
  let pendingSnapshot;
  const gitlabRequests = [];
  async function start() {
    instance = await createApp({
      dataDir: directory, autoSync: false,
      authenticate: async (username) => ({ jar: new CookieJar(), user: { id: username, name: username } }),
      getGitlabReadme: async (url, { token }) => {
        gitlabRequests.push({ url, token });
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { branch: "main", readme: { path: "README.md", content: "# Private README", markdown: true, webUrl: `${url}/-/blob/main/README.md` } };
      },
      getGitlabBranches: async (_, { token }) => {
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { branches: [{ name: "main", default: true, commit: null }, { name: "feature/kotlin", default: false, commit: null }] };
      },
      getGitlabCommits: async (url, { token, ref, page }) => {
        gitlabRequests.push({ url, token, ref, page });
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { commits: [{ id: "a".repeat(40), title: "Course update" }], nextPage: 3 };
      },
      getGitlabCommit: async (url, sha, { token, page }) => {
        gitlabRequests.push({ url, token, sha, page });
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { commit: { id: sha }, diffs: [{ newPath: "README.md", diff: "@@ -1 +1 @@\n-old\n+new\n" }], nextPage: null };
      },
      getGitlabTree: async (_, folder, { token }) => {
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { branch: "main", path: folder, entries: [{ path: "src/index.ts", name: "index.ts", directory: false }] };
      },
      getGitlabFile: async (_, file, { token, ref }) => {
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return { path: file, content: "export const answer = 42;", binary: false, ref };
      },
      getGitlabContent: async (_, __, { token }) => {
        if (!token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
        return new Response(Buffer.from([0, 255, 2]), { headers: { "Content-Type": "text/plain" } });
      },
      getSnapshot: async (_, user) => {
        if (pendingSnapshot) await pendingSnapshot;
        return {
          courses: [{ id: "shared", title: "Shared course" }, { id: `${user.id}-course`, title: "Private course" }],
          resources: [],
        };
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
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(route, cookie, body, origin) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(origin ? { Origin: origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie() };
  }
  async function login(username) {
    const result = await request("/api/auth/login", null, { username, password: "test" });
    assert.equal(result.status, 200);
    const cookie = result.cookies.find((value) => value.startsWith("campus.sid=")).split(";")[0];
    for (let i = 0; i < 50; i++) {
      if (!(await request("/api/state", cookie)).data.syncing) return cookie;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("sync timeout");
  }
  await start();
  const alice = await login("alice"), bob = await login("bob");
  const route = "/api/courses/shared/gitlab";
  const url = "https://gitlab.com/course/project";
  assert.equal((await request(route, null, { url })).status, 401);
  assert.equal((await request("/api/courses/alice-course/gitlab", bob, { url })).status, 404);
  assert.equal((await request(route, alice, { url }, "https://other.example")).status, 403);
  assert.deepEqual(await request(route, alice, { url: `${url}.git/` }), {
    status: 200, data: { project: { url } }, cookies: [],
  });
  assert.deepEqual((await request("/api/state", alice)).data.gitlabProjects, { shared: { url } });

  const readmeRoute = `${route}/readme`, tokenRoute = `${route}/token`;
  assert.equal((await request(tokenRoute)).status, 401);
  assert.equal((await request(tokenRoute, bob)).status, 404);
  assert.deepEqual((await request(tokenRoute, alice)).data, { connected: false });
  assert.equal((await request(readmeRoute)).status, 401);
  assert.equal((await request(readmeRoute, bob)).status, 404);
  assert.equal((await request(readmeRoute, alice)).data.code, "GITLAB_AUTH_REQUIRED");
  for (const suffix of ["/commits?ref=feature%2Fcourse&page=2", `/commit?sha=${"a".repeat(40)}&page=2`]) {
    assert.equal((await request(route + suffix)).status, 401);
    assert.equal((await request(route + suffix, bob)).status, 404);
    assert.equal((await request(route + suffix, alice)).data.code, "GITLAB_AUTH_REQUIRED");
  }
  assert.equal((await request(tokenRoute, alice, { token: "test" }, "https://other.example")).status, 403);
  assert.equal((await request(tokenRoute, alice, { token: "bad token" })).status, 400);
  const secret = "private-gitlab-test-token";
  assert.deepEqual((await request(tokenRoute, alice, { token: secret })).data, { connected: true });
  assert.deepEqual((await request(tokenRoute, alice)).data, { connected: true });
  const branches = await request(`${route}/branches`, alice);
  assert.equal(branches.status, 200);
  assert.deepEqual(branches.data.branches.map(branch => branch.name), ["main", "feature/kotlin"]);
  assert.equal((await request(`${route}/branches`, bob)).status, 404);
  assert.equal((await request(`${route}/branches`)).status, 401);
  const readme = await request(readmeRoute, alice);
  assert.equal(readme.status, 200);
  assert.equal(readme.data.readme.content, "# Private README");
  assert.equal(readme.data.hasToken, true);
  assert.equal(gitlabRequests.at(-1).token, secret);
  const history = await request(`${route}/commits?ref=feature%2Fcourse&page=2`, alice);
  assert.equal(history.status, 200);
  assert.equal(history.data.nextPage, 3);
  assert.deepEqual(gitlabRequests.at(-1), { url, token: secret, ref: "feature/course", page: "2" });
  const diff = await request(`${route}/commit?sha=${"a".repeat(40)}&page=2`, alice);
  assert.equal(diff.status, 200);
  assert.match(diff.data.diffs[0].diff, /\+new/);
  assert.deepEqual(gitlabRequests.at(-1), { url, token: secret, sha: "a".repeat(40), page: "2" });
  assert.equal((await request(`${route}/tree?path=src`, alice)).data.entries[0].name, "index.ts");
  assert.equal((await request(`${route}/file?path=src%2Findex.ts&ref=main`, alice)).data.content, "export const answer = 42;");
  assert.equal((await request(`${route}/tree`, bob)).status, 404);
  assert.equal((await request(`${route}/file?path=src%2Findex.ts`)).status, 401);
  const download = await fetch(`${base}${route}/content?path=image.png&download=1`, { headers: { Cookie: alice } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from([0, 255, 2]));
  const image = await fetch(`${base}${route}/content?path=image.png`, { headers: { Cookie: alice } });
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("content-disposition"), /^inline/);
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  await image.arrayBuffer();
  const html = await fetch(`${base}${route}/content?path=page.html`, { headers: { Cookie: alice } });
  assert.match(html.headers.get("content-type"), /^text\/plain/);
  await html.arrayBuffer();
  assert.ok(!JSON.stringify((await request("/api/state", alice)).data).includes(secret));
  assert.ok(!(await readFile(path.join(directory, "sessions.enc"), "utf8")).includes(secret));
  assert.ok(!(await readFile(path.join(directory, "state.json"), "utf8")).includes(secret));

  // A newly linked project in another course uses the same server's token.
  const secondRoute = "/api/courses/alice-course/gitlab";
  assert.equal((await request(secondRoute, alice, { url: "https://gitlab.com/another-group/another-project" })).status, 200);
  assert.deepEqual((await request(`${secondRoute}/token`, alice)).data, { connected: true });
  for (const read of ["readme", "branches", "tree?path=src", "file?path=src%2Findex.ts", "content?path=image.png"]) {
    const response = await fetch(`${base}${secondRoute}/${read}`, { headers: { Cookie: alice } });
    assert.equal(response.status, 200, `Shared token works for ${read} in another course`);
    await response.arrayBuffer();
  }
  assert.equal(gitlabRequests.at(-1).token, secret);
  const replacementSecret = "replacement-gitlab-test-token";
  assert.equal((await request(`${secondRoute}/token`, alice, { token: replacementSecret })).status, 200);
  assert.equal((await request(readmeRoute, alice)).status, 200);
  assert.equal(gitlabRequests.at(-1).token, replacementSecret, "Replacing a token applies to every project on its server");
  assert.equal((await request(`${secondRoute}/token`, alice, { token: null })).status, 200);
  assert.deepEqual((await request(tokenRoute, alice)).data, { connected: false });
  assert.equal((await request(readmeRoute, alice)).status, 403);
  await request(`${secondRoute}/token`, alice, { token: secret });
  await request(secondRoute, alice, { url: null });
  assert.equal((await request(readmeRoute, alice)).status, 200, "Unlinking one project keeps the shared token");

  assert.equal((await request(route, bob, { url })).status, 200);
  assert.deepEqual((await request(tokenRoute, bob)).data, { connected: false });
  assert.equal((await request(readmeRoute, bob)).status, 403);
  assert.equal(gitlabRequests.at(-1).token, undefined);
  await request(route, bob, { url: null });
  assert.deepEqual((await request("/api/state", bob)).data.gitlabProjects, {});
  assert.equal((await request("/api/demo")).data.gitlabProjects, undefined);
  for (const body of [{}, { url: "javascript:alert(1)" }, { url: { bad: true } }])
    assert.equal((await request(route, alice, body)).status, 400);
  assert.deepEqual((await request("/api/state", alice)).data.gitlabProjects, { shared: { url } });

  // Saving during a Stud.IP fetch must survive the incoming snapshot.
  pendingSnapshot = new Promise((resolve) => { releaseSnapshot = resolve; });
  const syncing = request("/api/sync", alice, {});
  for (let i = 0; i < 50; i++) {
    if ((await request("/api/state", alice)).data.syncing) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const replacement = "https://gitlab.university.example/class/new-project";
  assert.equal((await request(route, alice, { url: replacement })).status, 200);
  releaseSnapshot();
  pendingSnapshot = null;
  assert.equal((await syncing).status, 200);
  const state = (await request("/api/state", alice)).data;
  assert.deepEqual(state.gitlabProjects, { shared: { url: replacement } });
  assert.deepEqual(state.changes, []);
  assert.equal((await request(readmeRoute, alice)).status, 403);
  assert.equal(gitlabRequests.at(-1).token, undefined, "A token is never forwarded to another GitLab host");
  assert.deepEqual((await request(tokenRoute, alice)).data, { connected: false });

  await stop();
  await start();
  assert.deepEqual((await request("/api/state", alice)).data.gitlabProjects, { shared: { url: replacement } });
  assert.deepEqual((await request("/api/state", bob)).data.gitlabProjects, {});
  await request(route, alice, { url });
  assert.equal((await request(readmeRoute, alice)).status, 200, "Encrypted session restores its token after restart");
  assert.deepEqual((await request(tokenRoute, alice, { token: null })).data, { connected: false });
  assert.equal((await request(readmeRoute, alice)).status, 403);
  assert.deepEqual((await request(route, alice, { url: null })).data, { project: null });
  assert.deepEqual((await request("/api/state", alice)).data.gitlabProjects, {});
  await stop();
  await start();
  assert.deepEqual((await request("/api/state", alice)).data.gitlabProjects, {});
});
