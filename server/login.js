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
    throw new StudipError("Введи логин и пароль Stud.IP.", 400);
  }
  return { username: username.trim(), password };
}

/** @param {string | URL} value @param {string | URL} base */
function universityUrl(value, base = START) {
  const url = new URL(value, base);
  if (url.origin !== BASE || url.username || url.password) {
    throw new StudipError(
      "Stud.IP предлагает внешний способ входа, который пока не поддерживается.",
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
          "Stud.IP сейчас недоступен. Попробуй войти позже.",
          503,
        );
      }
      for (const cookie of response.headers.getSetCookie())
        await jar.setCookie(cookie, url.href);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw new StudipError("Stud.IP вернул некорректное перенаправление.");
        const next = universityUrl(location, url);
        // Never re-post a password to a different endpoint, even on the university host.
        if (
          [307, 308].includes(response.status) &&
          method === "POST" &&
          next.pathname !== url.pathname
        ) {
          throw new StudipError(
            "Stud.IP изменил адрес формы входа. Попробуй позже.",
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
          "Stud.IP ограничил попытки входа. Попробуй позже.",
          429,
        );
      if (!response.ok)
        throw new StudipError("Не удалось открыть форму входа Stud.IP.", 503);
      return { html: await response.text(), url };
    }
    throw new StudipError("Не удалось завершить перенаправления Stud.IP.");
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
    throw new StudipError("Форма входа Stud.IP изменилась. Попробуй позже.");
  }
  const action = universityUrl(form.attr("action") || START, page.url);
  if (action.pathname !== "/dispatch.php/start" || action.search)
    throw new StudipError("Неподдерживаемая форма входа Stud.IP.");
  const fields = new URLSearchParams();
  form.find('input[type="hidden"]').each((_, element) => {
    const name = $(element).attr("name");
    if (name) fields.set(name, $(element).attr("value") || "");
  });
  if (!fields.get("security_token") || !fields.get("login_ticket"))
    throw new StudipError("Не удалось подготовить защищённую форму входа.");
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
      throw new StudipError("Неверный логин или пароль Stud.IP.", 401);
    throw error;
  }
  if (
    !profile ||
    Array.isArray(profile) ||
    typeof profile.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.id)
  ) {
    throw new StudipError("Stud.IP не подтвердил вход в аккаунт.");
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
