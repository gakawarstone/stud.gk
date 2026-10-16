import test from "node:test";
import assert from "node:assert/strict";
import { createGitlabClient, repositoryPath, validateGitlabToken } from "./gitlab-client.js";
import { isPublicAddress, publicRequest } from "./public-http.js";

test("GitLab reads the project's actual README and default branch using GET with an origin-scoped token", async () => {
  const requests = [];
  const client = createGitlabClient(async (url, options) => {
    requests.push({ url, options });
    if (!url.pathname.endsWith("/raw")) return Response.json({
      default_branch: "course/fall", readme_url: "https://gitlab.example/team/sub/project/-/blob/course/fall/docs/Readme.markdown",
    });
    return new Response("# Course\n\nA **README**.");
  });
  const result = await client.readme("https://gitlab.example/team/sub/project", { token: "test-token" });
  assert.equal(requests[0].url.pathname, "/api/v4/projects/team%2Fsub%2Fproject");
  assert.equal(requests[1].url.pathname, "/api/v4/projects/team%2Fsub%2Fproject/repository/files/docs%2FReadme.markdown/raw");
  assert.equal(requests[1].url.searchParams.get("ref"), "course/fall");
  for (const { options } of requests) {
    assert.equal(options.headers["PRIVATE-TOKEN"], "test-token");
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.body, undefined);
  }
  assert.equal(result.branch, "course/fall");
  assert.equal(result.readme.path, "docs/Readme.markdown");
  assert.equal(result.readme.markdown, true);
  assert.equal(result.readme.content, "# Course\n\nA **README**.");
});

test("GitLab distinguishes no README, missing access, throttling, redirects and invalid upstream content", async () => {
  assert.deepEqual(await createGitlabClient(async () => Response.json({ default_branch: "main", readme_url: null }))
    .readme("https://gitlab.example/team/project"), { branch: "main", readme: null });
  for (const status of [401, 403, 404, 429, 302, 500]) {
    let requests = 0;
    const client = createGitlabClient(async () => { requests++; return new Response("failure", { status, headers: { Location: "https://other.example/" } }); });
    await assert.rejects(client.readme("https://gitlab.example/team/project"), (error) =>
      error.status === ([401, 403, 404].includes(status) ? 403 : status === 429 ? 429 : 502));
    assert.equal(requests, 1);
  }
  const metadata = { default_branch: "main", readme_url: "https://gitlab.example/team/project/-/blob/main/README.md" };
  let requests = 0;
  await assert.rejects(createGitlabClient(async () => ++requests === 1 ? Response.json(metadata)
    : new Response("x".repeat(1024 * 1024 + 1))).readme("https://gitlab.example/team/project"), (error) => error.status === 413);
  await assert.rejects(createGitlabClient(async () => new Response("<html>Login</html>"))
    .readme("https://gitlab.example/team/project"), (error) => error.status === 502);
  await assert.rejects(createGitlabClient(async () => Response.json({ ...metadata, readme_url: "https://other.example/README.md" }))
    .readme("https://gitlab.example/team/project"), (error) => error.status === 502);
});

test("GitLab tokens reject controls and plain HTTP, and outbound reads reject private networks", async () => {
  for (const token of [undefined, "", "a b", "a\r\nInjected: yes", "x".repeat(513), {}])
    assert.throws(() => validateGitlabToken(token), (error) => error.status === 400);
  let calls = 0;
  await assert.rejects(createGitlabClient(async () => { calls++; }).readme("http://gitlab.example/team/project", { token: "test" }),
    (error) => error.status === 400);
  assert.equal(calls, 0);
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(publicRequest(new URL("http://127.0.0.1/api/v4/projects/test")), /not public/);
});

test("repository browsing reads every page, pins the branch, and sorts folders before files", async () => {
  const requests = [];
  const client = createGitlabClient(async (url, options) => {
    requests.push({ url, options });
    if (!url.pathname.endsWith("/tree")) return Response.json({ default_branch: "main" });
    assert.equal(url.searchParams.get("ref"), "course/fall");
    assert.equal(url.searchParams.get("path"), "src");
    return url.searchParams.get("page") === "1"
      ? Response.json([{ path: "src/index.ts", type: "blob", id: "1" }, { path: "src/components", type: "tree", id: "2" },
        { path: "other/private.ts", type: "blob" }], { headers: { "X-Next-Page": "2" } })
      : Response.json([{ path: "src/index.ts", type: "blob", id: "1" }, { path: "src/styles.css", type: "blob", id: "3" }], { headers: { "X-Next-Page": "" } });
  });
  const result = await client.list("https://gitlab.example/group/project", "src", { token: "test-token", ref: "course/fall" });
  assert.deepEqual(result.entries.map((entry) => entry.path), ["src/components", "src/index.ts", "src/styles.css"]);
  assert.equal(result.branch, "course/fall");
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ options }) => options.headers["PRIVATE-TOKEN"] === "test-token"));
  const invalid = createGitlabClient(async (url) => url.pathname.endsWith("/tree")
    ? Response.json([], { headers: { "X-Next-Page": "https://other.example" } }) : Response.json({ default_branch: "main" }));
  await assert.rejects(invalid.list("https://gitlab.example/group/project"), (error) => error.status === 502);
});

test("repository file reads distinguish UTF-8 from binary and reject traversal or oversized previews", async () => {
  const paths = [];
  const client = createGitlabClient(async (url) => {
    paths.push(url);
    return url.pathname.includes("image.png") ? new Response(Buffer.from([0, 255, 2])) : new Response('export const answer = 42;\n');
  });
  const source = await client.file("https://gitlab.example/group/project", "src/index.ts", { ref: "feature/course" });
  assert.equal(source.content, 'export const answer = 42;\n');
  assert.equal(source.binary, false);
  assert.equal(paths[0].pathname, "/api/v4/projects/group%2Fproject/repository/files/src%2Findex.ts/raw");
  assert.equal(paths[0].searchParams.get("ref"), "feature/course");
  const binary = await client.file("https://gitlab.example/group/project", "image.png");
  assert.equal(binary.binary, true); assert.equal(binary.content, null); assert.equal(binary.size, 3);
  for (const path of ["../secret", "src/../secret", "/etc/passwd", "src//x", "x\nheader", "src\\secret", {}])
    assert.throws(() => repositoryPath(path), (error) => error.status === 400);
  assert.equal(repositoryPath("src/a b.ts"), "src/a b.ts");
  await assert.rejects(client.file("https://gitlab.example/group/project", "x.ts", { ref: "bad\nref" }), (error) => error.status === 400);
  await assert.rejects(createGitlabClient(async () => new Response("x".repeat(2 * 1024 * 1024 + 1)))
    .file("https://gitlab.example/group/project", "large.txt"), (error) => error.status === 413);
  const raw = await client.content("https://gitlab.example/group/project", "image.png");
  assert.deepEqual(Buffer.from(await raw.arrayBuffer()), Buffer.from([0, 255, 2]));
});

test("branches paginate safely and expose each branch's latest commit without trusting upstream URLs", async () => {
  const requests = [];
  const client = createGitlabClient(async (url, options) => {
    requests.push(url);
    assert.equal(options.headers['PRIVATE-TOKEN'], 'fixture');
    return url.searchParams.get('page') === '1'
      ? Response.json([{ name: 'main', default: true, commit: { id: 'a'.repeat(40), title: 'Initial commit', author_name: 'Ada', committed_date: '2026-10-16T12:00:00Z', web_url: 'https://evil.example' } }], { headers: { 'X-Next-Page': '2' } })
      : Response.json([{ name: 'feature/kotlin', default: false, commit: { id: 'b'.repeat(40), title: 'Add Kotlin' } }], { headers: { 'X-Next-Page': '' } });
  });
  const result = await client.branches('https://gitlab.example/team/project', { token: 'fixture' });
  assert.deepEqual(result.branches.map(branch => branch.name), ['main', 'feature/kotlin']);
  assert.equal(result.branches[0].default, true);
  assert.equal(result.branches[0].commit.author, 'Ada');
  assert.equal(result.branches[1].commit.shortId, 'bbbbbbbb');
  assert.equal(result.branches[0].commit.webUrl, 'https://gitlab.example/team/project/-/commit/' + 'a'.repeat(40));
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => url.pathname.endsWith('/repository/branches')));
  const invalid = createGitlabClient(async () => Response.json([], { headers: { 'X-Next-Page': 'https://evil.example' } }));
  await assert.rejects(invalid.branches('https://gitlab.example/team/project'), error => error.status === 502);
  assert.deepEqual(await createGitlabClient(async () => Response.json([])).branches('https://gitlab.example/team/project'), { branches: [] });
});
