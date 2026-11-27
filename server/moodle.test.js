import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { createMoodleClient, moodleUrl, MoodleError, MOODLE_SITE } from "./moodle.js";
import { createApp } from "./app.js";

const connection = { url: "https://moodle.example.edu/campus", token: "a".repeat(32) };
test("Moodle exchanges the university password only at the campus mobile login endpoint", async () => {
  const client = createMoodleClient(async (url, { method, body }) => {
    assert.equal(url.href, "https://moodle.hs-flensburg.de/login/token.php");
    assert.equal(method, "POST");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(body)), {
      username: "abcd1234",
      password: "password + & =",
      service: "moodle_mobile_app",
    });
    return Response.json({ token: connection.token, privatetoken: "ignored" });
  });
  assert.deepEqual(await client.signIn("abcd1234", "password + & ="), {
    url: MOODLE_SITE,
    token: connection.token,
  });

  for (const response of [
    Response.json({ errorcode: "invalidlogin", error: "password + & =" }),
    new Response(null, { status: 307, headers: { Location: "https://other.example/login" } }),
  ]) {
    let requests = 0;
    const denied = createMoodleClient(async () => { requests++; return response; });
    await assert.rejects(denied.signIn("abcd1234", "password + & ="), error =>
      error instanceof MoodleError && !error.message.includes("password + & ="));
    assert.equal(requests, 1);
  }
});
test("Moodle uses POST bodies, preserves installation paths and returns enrolled courses", async () => {
  const calls = [];
  const client = createMoodleClient(async (url, options) => {
    const params = new URLSearchParams(options.body); calls.push({ url, options, params });
    return Response.json(params.get("wsfunction") === "core_webservice_get_site_info" ? { userid: 7, sitename: "Campus &amp; learning" } : [{ id: 42, fullname: "<b>Software engineering</b>", shortname: "SE" }]);
  });
  const result = await client.courses(connection);
  assert.equal(result.site, "Campus & learning");
  assert.equal(result.courses[0].title, "Software engineering");
  assert.equal(calls[0].url.href, "https://moodle.example.edu/campus/webservice/rest/server.php");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].params.get("wstoken"), connection.token);
  assert.equal(calls[1].params.get("userid"), "7");
});
test("Moodle contents omit hidden activities, HTML and upstream token-bearing links", async () => {
  const client = createMoodleClient(async () => Response.json([
    { id: 0, visible: 0 },
    { id: 1, name: "Week 1", summary: "<p>Read &amp; learn</p>", modules: [
      { id: 9, modname: "resource", name: "Slides", description: "<b>PDF</b>", url: "javascript:alert(1)", contents: [{ fileurl: "https://evil/?token=secret" }] },
      { id: 10, modname: "assign", uservisible: false },
      { id: 11, modname: "../evil", name: "Invalid" },
    ] },
  ]));
  const result = await client.contents(connection, 42);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].summary, "Read & learn");
  assert.equal(result.sections[0].modules.length, 2);
  assert.equal(result.sections[0].modules[0].url, "https://moodle.example.edu/campus/mod/resource/view.php?id=9");
  assert.equal(result.sections[0].modules[1].url, null);
  assert.ok(!JSON.stringify(result).includes("secret"));
  await assert.rejects(client.contents(connection, -1), e => e.status === 400);
});
test("Moodle rejects unsafe URLs, private hosts, redirects and malformed or denied responses", async () => {
  for (const url of ["http://example.edu", "https://user:pass@example.edu", "https://example.edu/?token=x", "https://example.edu/#x", "https://example.edu:8443", null, {}]) assert.throws(() => moodleUrl(url), MoodleError);
  await assert.rejects(createMoodleClient().courses({ ...connection, url: "https://127.0.0.1" }), MoodleError);
  for (const payload of [{ exception: "error", errorcode: "invalidtoken", message: connection.token }, { userid: null }]) {
    await assert.rejects(createMoodleClient(async () => Response.json(payload)).courses(connection), e => !e.message.includes(connection.token));
  }
  await assert.rejects(createMoodleClient(async () => new Response("", { status: 302 })).courses(connection), MoodleError);
  await assert.rejects(createMoodleClient(async () => new Response("<html>login</html>")).courses(connection), MoodleError);
});
test("Moodle routes require login, isolate sessions, encrypt tokens and disconnect", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "moodle-test-"));
  const instance = await createApp({ dataDir: directory, autoSync: false,
    authenticate: async username => ({ user: { id: username, name: username }, jar: new CookieJar() }),
    getSnapshot: async () => ({ courses: [], resources: [] }),
    moodleClient: {
      signIn: async (username, password) => {
        assert.equal(username, "alice");
        assert.equal(password, "moodle fixture password");
        return { url: MOODLE_SITE, token: connection.token };
      },
      courses: async () => ({ site: "Campus", courses: [{ id: 42, title: "SE", shortname: "SE" }] }),
      contents: async () => ({ sections: [] }),
    },
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, cookie = "", body) {
    return fetch(base + route, { method: body ? "POST" : "GET", headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    assert.equal((await request("/api/moodle/courses")).status, 401);
    const login = await request("/api/auth/login", "", { username: "alice", password: "fixture" });
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    assert.equal((await request("/api/moodle/connect", cookie, connection)).status, 400);
    const connected = await request("/api/moodle/connect", cookie, {
      username: "alice",
      password: "moodle fixture password",
      url: "https://other.example/",
    });
    assert.equal(connected.status, 200);
    assert.ok(!(await connected.text()).includes(connection.token));
    const result = await request("/api/moodle/courses", cookie);
    assert.equal((await result.json()).connected, true);
    assert.ok(!(await readFile(path.join(directory, "sessions.enc"), "utf8")).includes(connection.token));
    const sessions = await new Promise((resolve, reject) =>
      instance.store.all((error, values) => error ? reject(error) : resolve(values)));
    assert.ok(!JSON.stringify(sessions).includes("moodle fixture password"));
    const other = await request("/api/auth/login", "", { username: "bob", password: "fixture" });
    const otherCookie = other.headers.getSetCookie()[0].split(";")[0];
    assert.equal((await (await request("/api/moodle/courses", otherCookie)).json()).connected, false);
    assert.equal((await request("/api/moodle/disconnect", cookie, {})).status, 200);
    assert.equal((await (await request("/api/moodle/courses", cookie)).json()).connected, false);
  } finally {
    await new Promise(r => server.close(r)); await instance.close(); await rm(directory, { recursive: true, force: true });
  }
});
