import test from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "tough-cookie";
import { loginStudip, validateCredentials } from "./login.js";
import { createClient, BASE } from "./studip.js";

const loginForm = `<form id="login-form" method="post" action="${BASE}/dispatch.php/start">
<input name="loginname"><input type="password" name="password">
<input type="hidden" name="security_token" value="csrf&amp;token">
<input type="hidden" name="login_ticket" value="ticket123"></form>`;
test("login submits the real form fields, follows redirects with cookies and verifies the profile", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: url.href, options });
    if (calls.length === 1)
      return new Response(loginForm, {
        headers: {
          "Set-Cookie": "PHPSESSID=anonymous; Path=/; Secure; HttpOnly",
        },
      });
    if (calls.length === 2)
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/dispatch.php/start",
          "Set-Cookie": "PHPSESSID=authenticated; Path=/; Secure; HttpOnly",
        },
      });
    if (calls.length === 3) return new Response("<h1>Welcome</h1>");
    return new Response(
      JSON.stringify({
        data: { id: "u1", attributes: { "formatted-name": "Test Student" } },
      }),
    );
  };
  const result = await loginStudip(" student ", "p&+= ässword", fetcher);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((c) => c.options.method),
    ["GET", "POST", "GET", "GET"],
  );
  const fields = new URLSearchParams(calls[1].options.body);
  assert.equal(fields.get("loginname"), "student");
  assert.equal(fields.get("password"), "p&+= ässword");
  assert.equal(fields.get("security_token"), "csrf&token");
  assert.equal(fields.get("login_ticket"), "ticket123");
  assert.match(calls[1].options.headers.Cookie, /anonymous/);
  assert.match(calls[3].options.headers.Cookie, /authenticated/);
  assert.equal(calls[3].options.headers.Accept, "application/vnd.api+json");
  assert.equal(result.user.name, "Test Student");
  assert.ok(!JSON.stringify(result.jar.toJSON()).includes("ässword"));
  assert.ok(!("password" in result));
});
test("wrong credentials do not produce a logged-in user", async () => {
  let call = 0;
  const fetcher = async () =>
    ++call < 3 ? new Response(loginForm) : new Response(null, { status: 401 });
  await assert.rejects(
    loginStudip("student", "wrong", fetcher),
    (error) => error.status === 401 && /Неверный логин/.test(error.message),
  );
});
test("the password and cookies never follow redirects off the university host", async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url.href);
    return urls.length === 1
      ? new Response(loginForm)
      : new Response(null, {
          status: 307,
          headers: { Location: "https://other.example/login" },
        });
  };
  await assert.rejects(loginStudip("student", "secret", fetcher), /внешний/);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((url) => url.startsWith(BASE)));
});
test("refuses forms without CSRF fields or a recognized action", async () => {
  for (const html of [
    loginForm.replace(/<input type="hidden"[^>]*>/g, ""),
    loginForm.replace("/dispatch.php/start", "/dispatch.php/course/delete"),
  ]) {
    let calls = 0;
    await assert.rejects(
      loginStudip("student", "secret", async () => {
        calls++;
        return new Response(html);
      }),
    );
    assert.equal(calls, 1);
  }
});
test("validates inputs without trimming the password", () => {
  assert.deepEqual(validateCredentials(" user ", " password "), {
    username: "user",
    password: " password ",
  });
  for (const [user, password] of [
    ["", "secret"],
    ["user", ""],
    [null, "secret"],
    ["user\n", "secret"],
    ["user", "secret\n"],
  ])
    assert.throws(() => validateCredentials(user, password));
});
test("JSON API cookies are refreshed in the server-side jar", async () => {
  const jar = new CookieJar();
  await jar.setCookie("PHPSESSID=old; Path=/; Secure", BASE);
  const client = createClient(
    jar,
    async () =>
      new Response(JSON.stringify({ data: [] }), {
        headers: { "Set-Cookie": "PHPSESSID=new; Path=/; Secure" },
      }),
  );
  await client.list("courses");
  assert.match(await jar.getCookieString(BASE), /PHPSESSID=new/);
});
