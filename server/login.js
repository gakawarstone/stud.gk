import { load } from "cheerio";
import { CookieJar } from "tough-cookie";
import { BASE, createClient, StudipError } from "./studip.js";

const START = `${BASE}/dispatch.php/start`;
export function validateCredentials(username, password) {
  if (
    typeof username !== "string" ||
    !username.trim() ||
    username.length > 128 ||
    typeof password !== "string" ||
    !password ||
    password.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(username) ||
    /[\x00\r\n]/.test(password)
  ) {
    throw new StudipError("Enter your Stud.IP username and password.", 400);
  }
  return { username: username.trim(), password };
}

/** @param {string | URL} value @param {string | URL} base */
function universityUrl(value, base = START) {
  const url = new URL(value, base);
  if (url.origin !== BASE || url.username || url.password) {
    throw new StudipError(
      "Stud.IP uses an external sign-in method that is not supported yet.",
      502,
    );
  }
  return url;
}

// Submit the university's own login form. The password is never kept in a client or session.
export async function loginStudip(username, password, fetcher = fetch) {
  const credentials = validateCredentials(username, password);
  const jar = new CookieJar();
  async function visit(start, options = {}) {
    let url = universityUrl(start),
      method = options.method || "GET",
      body = options.body;
    for (let redirect = 0; redirect < 8; redirect++) {
      let response;
      try {
        response = await fetcher(url, {
          method,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: "text/html",
            Cookie: await jar.getCookieString(url.href),
            ...(method === "POST"
              ? {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Origin: BASE,
                  Referer: START,
                }
              : {}),
          },
        });
      } catch {
        throw new StudipError(
          "Stud.IP is currently unavailable. Try signing in later.",
          503,
        );
      }
      for (const cookie of response.headers.getSetCookie())
        await jar.setCookie(cookie, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw new StudipError("Stud.IP returned an invalid redirect.");
        const next = universityUrl(location, url);
        // Never re-post a password to a different endpoint, even on the university host.
        if (
          [307, 308].includes(response.status) &&
          method === "POST" &&
          next.pathname !== url.pathname
        ) {
          throw new StudipError(
            "The Stud.IP sign-in form URL has changed. Try again later.",
          );
        }
        if (
          response.status === 303 ||
          (method === "POST" && [301, 302].includes(response.status))
        ) {
          method = "GET";
          body = undefined;
        }
        url = next;
        await response.body?.cancel();
        continue;
      }
      if (response.status === 429)
        throw new StudipError(
          "Stud.IP has limited sign-in attempts. Try again later.",
          429,
        );
      if (!response.ok)
        throw new StudipError("Could not open the Stud.IP sign-in form.", 503);
      return { html: await response.text(), url };
    }
    throw new StudipError("Could not complete the Stud.IP redirects.");
  }
  const page = await visit(START);
  const $ = load(page.html);
  const form = $("form#login-form").first();
  if (
    !form.length ||
    form.attr("method")?.toLowerCase() !== "post" ||
    !form.find('input[name="loginname"]').length ||
    !form.find('input[name="password"]').length
  ) {
    throw new StudipError("The Stud.IP sign-in form has changed. Try again later.");
  }
  const action = universityUrl(form.attr("action") || START, page.url);
  if (action.pathname !== "/dispatch.php/start" || action.search)
    throw new StudipError("Unsupported Stud.IP sign-in form.");
  const fields = new URLSearchParams();
  form.find('input[type="hidden"]').each((_, element) => {
    const name = $(element).attr("name");
    if (name) fields.set(name, $(element).attr("value") || "");
  });
  if (!fields.get("security_token") || !fields.get("login_ticket"))
    throw new StudipError("Could not prepare the secure sign-in form.");
  fields.set("loginname", credentials.username);
  fields.set("password", credentials.password);
  fields.set("Login", "");
  await visit(action.href, { method: "POST", body: fields.toString() });
  const client = createClient(jar, fetcher);
  let profile;
  try {
    profile = (await client.get("users/me")).data;
  } catch (error) {
    if (error.status === 401)
      throw new StudipError("Incorrect Stud.IP username or password.", 401);
    throw error;
  }
  if (
    !profile ||
    Array.isArray(profile) ||
    typeof profile.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.id)
  ) {
    throw new StudipError("Stud.IP did not confirm sign-in.");
  }
  return {
    jar,
    client,
    user: {
      id: profile.id,
      name: profile.attributes?.["formatted-name"] || credentials.username,
    },
  };
}
