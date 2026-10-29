import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import { createApp } from "./app.js";
import { StudipError, BASE } from "./studip.js";
import { validateCredentials } from "./login.js";
import { EncryptedSessionStore } from "./sessions.js";

const call = (object, method, ...args) =>
  new Promise((resolve, reject) =>
    object[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
async function fixture(directory) {
  const counts = new Map();
  let fail = false;
  const instance = await createApp({
    dataDir: directory,
    autoSync: false,
    authenticate: async (username, password) => {
      validateCredentials(username, password);
      if (password !== "test-secret-password")
        throw new StudipError("Incorrect Stud.IP username or password.", 401);
      const jar = new CookieJar();
      await jar.setCookie(
        `PHPSESSID=private-${username}-token; Path=/; Secure; HttpOnly`,
        BASE,
      );
      return { jar, user: { id: username, name: username } };
    },
    getSnapshot: async (client, user) => {
      if (fail && user.id === "alice")
        throw new StudipError("Session expired", 401);
      const count = (counts.get(user.id) || 0) + 1;
      counts.set(user.id, count);
      return {
        courses: [
          { id: `${user.id}-course`, title: `${user.id} private course` },
        ],
        resources: [
          {
            id: `${user.id}-file`,
            title: `${user.id} private notes ${count}`,
            courseId: `${user.id}-course`,
            kind: "file",
          },
        ],
        semester: "WS",
      };
    },
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, cookie, body, origin) {
    const headers = {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(origin ? { Origin: origin } : {}),
    };
    const response = await fetch(base + route, {
      headers,
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookies: response.headers.getSetCookie(),
    };
  }
  async function idle(cookie) {
    for (let i = 0; i < 50; i++) {
      const result = await request("/api/state", cookie);
      if (!result.data.syncing) return result;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("sync timeout");
  }
  async function login(username, existing) {
    const result = await request("/api/auth/login", existing, {
      username,
      password: "test-secret-password",
    });
    assert.equal(result.status, 200);
    const cookie = result.cookies
      .find((c) => c.startsWith("campus.sid="))
      .split(";")[0];
    await idle(cookie);
    return { cookie, header: result.cookies[0] };
  }
  return {
    ...instance,
    request,
    idle,
    login,
    fail: () => {
      fail = true;
    },
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await instance.close();
    },
  };
}

test("login isolates browser accounts, rotates sessions and protects private routes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-auth-"));
  const app = await fixture(directory);
  try {
    assert.deepEqual((await app.request("/api/state")).data, {
      authenticated: false,
      authExpired: false,
    });
    assert.equal((await app.request("/api/changes")).status, 401);
    assert.equal((await app.request("/api/sync", null, {})).status, 401);
    assert.equal(
      (
        await app.request("/api/auth/login", null, {
          username: "alice",
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await app.request(
          "/api/auth/login",
          null,
          { username: "alice", password: "test-secret-password" },
          "https://other.example",
        )
      ).status,
      403,
    );
    const alice = await app.login("alice"),
      bob = await app.login("bob");
    assert.match(alice.header, /HttpOnly/);
    assert.match(alice.header, /SameSite=Strict/);
    assert.notEqual(alice.cookie, bob.cookie);
    assert.equal(
      (await app.request("/api/state", alice.cookie)).data.user.name,
      "alice",
    );
    assert.equal((await app.request("/api/state", alice.cookie)).data.user.id, "alice");
    assert.equal((await app.request("/api/state", bob.cookie)).data.user.id, "bob");
    assert.equal(
      (await app.request("/api/state", bob.cookie)).data.resources[0].title,
      "bob private notes 1",
    );
    assert.equal(
      (await app.request("/api/sync", alice.cookie, {})).status,
      200,
    );
    const aliceChanges = (await app.request("/api/changes", alice.cookie)).data
      .changes;
    assert.equal(aliceChanges.length, 1);
    assert.equal(
      (
        await app.request("/api/changes/read", bob.cookie, {
          id: aliceChanges[0].id,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await app.request("/api/changes/read", alice.cookie, {
          id: aliceChanges[0].id,
        })
      ).status,
      200,
    );
    assert.equal(
      (await app.request("/api/changes", alice.cookie)).data.changes[0].read,
      true,
    );
    const newLogin = await app.login("alice", alice.cookie);
    assert.notEqual(newLogin.cookie, alice.cookie);
    assert.equal(
      (await app.request("/api/state", alice.cookie)).data.authenticated,
      false,
    );
    assert.equal(
      (await app.request("/api/auth/logout", newLogin.cookie, {})).status,
      200,
    );
    assert.equal(
      (await app.request("/api/changes", newLogin.cookie)).status,
      401,
    );
    assert.equal(
      (await app.request("/api/state", bob.cookie)).data.authenticated,
      true,
    );
    const persisted = await readFile(
      path.join(directory, "sessions.enc"),
      "utf8",
    );
    assert.ok(!persisted.includes("private-bob-token"));
    assert.ok(!persisted.includes("test-secret-password"));
    assert.equal(
      (await stat(path.join(directory, "session.key"))).mode & 0o777,
      0o600,
    );
  } finally {
    await app.stop();
    await rm(directory, { recursive: true });
  }
});
test("sessions restore after a server restart and expire when Stud.IP rejects them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-restore-"));
  let app = await fixture(directory);
  try {
    const alice = await app.login("alice"),
      bob = await app.login("bob");
    await app.stop();
    app = await fixture(directory);
    assert.equal(
      (await app.request("/api/state", alice.cookie)).data.user.name,
      "alice",
    );
    app.fail();
    assert.equal(
      (await app.request("/api/sync", alice.cookie, {})).status,
      401,
    );
    assert.deepEqual((await app.request("/api/state", alice.cookie)).data, {
      authenticated: false,
      authExpired: true,
    });
    assert.equal((await app.request("/api/changes", alice.cookie)).status, 401);
    assert.equal(
      (await app.request("/api/state", bob.cookie)).data.user.name,
      "bob",
    );
  } finally {
    await app.stop();
    await rm(directory, { recursive: true });
  }
});
test("local session expiry is absolute and is not extended by polling", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-expire-"));
  let time = Date.now();
  try {
    const store = await EncryptedSessionStore.open(directory, () => time);
    const value = {
      auth: { expiresAt: time + 1000 },
      cookie: { expires: new Date(time + 10000).toISOString() },
    };
    await call(store, "set", "test-session", value);
    time += 500;
    await call(store, "touch", "test-session", {
      cookie: { expires: new Date(time + 20000).toISOString() },
    });
    time += 501;
    assert.equal(await call(store, "get", "test-session"), null);
    await store.queue;
  } finally {
    await rm(directory, { recursive: true });
  }
});
test("repeated failed logins are rate limited", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "campus-limit-"));
  const app = await fixture(directory);
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await app.request("/api/auth/login", null, {
            username: "alice",
            password: "wrong",
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await app.request("/api/auth/login", null, {
          username: "alice",
          password: "wrong",
        })
      ).status,
      429,
    );
  } finally {
    await app.stop();
    await rm(directory, { recursive: true });
  }
});
