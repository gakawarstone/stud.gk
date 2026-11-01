import { load } from "cheerio";
import { publicRequest } from "./public-http.js";

export class MoodleError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function moodleUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new MoodleError("Enter a valid Moodle HTTPS URL.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443"))
    throw new MoodleError("Use the Moodle HTTPS site URL without credentials, query or fragment.", 400);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}
const text = (value) => typeof value === "string" ? load(value).text().trim() : "";
export function createMoodleClient(request = publicRequest) {
  async function call(connection, fn, params = {}) {
    const url = new URL("webservice/rest/server.php", moodleUrl(connection.url));
    let response, data;
    try {
      response = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ wstoken: connection.token, wsfunction: fn, moodlewsrestformat: "json", ...params }).toString(),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      data = await response.json();
    } catch { throw new MoodleError("Could not connect to Moodle. Check the site URL and try again."); }
    if (data?.exception || data?.errorcode) {
      const invalid = ["invalidtoken", "accessexception", "requireloginerror"].includes(data.errorcode);
      throw new MoodleError(invalid ? "Moodle rejected the token or its permissions. Check your web service access." : "Moodle could not load this data. Check the service permissions.", invalid ? 403 : 502);
    }
    return data;
  }
  return {
    async courses(connection) {
      const site = await call(connection, "core_webservice_get_site_info");
      if (!Number.isSafeInteger(site?.userid) || site.userid <= 0) throw new MoodleError("Moodle returned invalid account data.");
      const courses = await call(connection, "core_enrol_get_users_courses", { userid: String(site.userid) });
      if (!Array.isArray(courses)) throw new MoodleError("Moodle returned an invalid course list.");
      return { site: text(site.sitename), courses: courses.filter(c => Number.isSafeInteger(c.id) && c.id > 0).map(c => ({ id: c.id, title: text(c.fullname), shortname: text(c.shortname) })) };
    },
    async contents(connection, courseId) {
      if (!Number.isSafeInteger(courseId) || courseId <= 0) throw new MoodleError("Choose a Moodle course.", 400);
      const sections = await call(connection, "core_course_get_contents", { courseid: String(courseId) });
      if (!Array.isArray(sections)) throw new MoodleError("Moodle returned invalid course contents.");
      const base = moodleUrl(connection.url);
      return { sections: sections.filter(s => s.visible !== 0).map(s => ({
        id: s.id, title: text(s.name), summary: text(s.summary),
        modules: (Array.isArray(s.modules) ? s.modules : []).filter(m => m.uservisible !== false && m.visible !== 0).map(m => ({
          id: m.id, title: text(m.name), kind: text(m.modname), description: text(m.description),
          // Build browser activity links ourselves; never expose token-bearing file URLs.
          url: Number.isSafeInteger(m.id) && /^[a-z][a-z0-9_]*$/.test(m.modname) ? new URL(`mod/${m.modname}/view.php?id=${m.id}`, base).href : null,
        })),
      })) };
    },
  };
}
