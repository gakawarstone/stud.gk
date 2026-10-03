export const BASE = "https://elearning.hs-flensburg.de";
const API = `${BASE}/jsonapi.php/v1/`;

export class StudipError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// No generic proxy: credentials go only to this fixed host and JSON:API path.
export function apiUrl(path) {
  const url = new URL(path, API);
  if (
    url.origin !== BASE ||
    !url.pathname.startsWith("/jsonapi.php/v1/") ||
    url.username ||
    url.password
  ) {
    throw new StudipError("Stud.IP вернул недопустимую ссылку пагинации.");
  }
  return url;
}

export function createClient(cookie, fetcher = fetch) {
  const jar =
    typeof cookie === "object" && typeof cookie?.getCookieString === "function"
      ? cookie
      : null;
  if (
    !jar &&
    (typeof cookie !== "string" ||
      !cookie.trim() ||
      /[\r\n]/.test(cookie) ||
      cookie.length > 16000)
  ) {
    throw new StudipError("Укажи действующую сессию Stud.IP.", 400);
  }
  async function get(path) {
    const url = apiUrl(path);
    let response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.api+json",
          Cookie: jar ? await jar.getCookieString(url.href) : cookie,
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new StudipError(
        "Не удалось связаться со Stud.IP. Попробуй ещё раз.",
      );
    }
    if (jar)
      for (const value of response.headers.getSetCookie())
        await jar.setCookie(value, url.href);
    if (response.status === 401)
      throw new StudipError(
        "Сессия Stud.IP истекла или не подходит. Подключись заново.",
        401,
      );
    if (response.status === 403)
      throw new StudipError("Stud.IP не разрешает читать эти данные.", 403);
    if (!response.ok)
      throw new StudipError(
        `Stud.IP вернул ошибку ${response.status}. Данные сохранены.`,
      );
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new StudipError("Stud.IP вернул ответ в неожиданном формате.");
    }
    if (!payload || !("data" in payload) || payload.errors)
      throw new StudipError("Некорректный ответ JSON API.");
    return payload;
  }
  async function list(path) {
    let next = path;
    const items = [],
      visited = new Set();
    while (next) {
      const url = apiUrl(next).href;
      if (visited.has(url) || visited.size >= 200)
        throw new StudipError("Не удалось полностью получить список Stud.IP.");
      visited.add(url);
      const payload = await get(url);
      if (!Array.isArray(payload.data))
        throw new StudipError("Stud.IP вернул некорректный список.");
      items.push(...payload.data);
      next =
        typeof payload.links?.next === "object"
          ? payload.links.next.href
          : payload.links?.next;
    }
    return items;
  }
  return { get, list };
}

const plain = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .trim();
const tones = ["mauve", "blue", "peach", "green", "pink", "teal"];
export function normalize(resource, kind, courseId) {
  const a = resource.attributes ?? {};
  const isFile = kind === "file";
  return {
    id: `${kind}:${courseId}:${resource.id}`,
    remoteId: resource.id,
    kind,
    courseId,
    title: plain(a.name || a.title || a["display-value"]) || "Без названия",
    description: plain(a.description || a.body || a.content),
    createdAt: a.mkdate ?? null,
    updatedAt: a.chdate ?? null,
    ...(isFile
      ? {
          size: a.filesize ?? 0,
          mime: a["mime-type"] ?? "",
          fileId: resource.relationships?.file?.data?.id ?? null,
        }
      : {}),
    ...(kind === "schedule"
      ? {
          start: a.start,
          end: a.end,
          location: plain(a.location),
          cancelled: Boolean(a["is-cancelled"]),
        }
      : {}),
  };
}

export async function fetchSnapshot(client, user) {
  const semesters = await client.list("semesters?page[limit]=100");
  const current = semesters.find((s) => s.attributes?.["is-current"]);
  const filter = current
    ? `&filter[semester]=${encodeURIComponent(current.id)}`
    : "";
  const rawCourses = await client.list(
    `users/${encodeURIComponent(user.id)}/courses?page[limit]=100${filter}`,
  );
  const courses = rawCourses.map((r, i) => ({
    id: r.id,
    title: plain(r.attributes?.title) || "Без названия",
    code: r.attributes?.["course-number"] || `Курс ${i + 1}`,
    description: plain(r.attributes?.description),
    location: plain(r.attributes?.location),
    color: tones[i % tones.length],
    semester: current?.attributes?.title || "Все семестры",
    url: `${BASE}/dispatch.php/course/overview?cid=${encodeURIComponent(r.id)}`,
  }));
  const resources = [],
    unavailableSources = [];
  // A denied course section does not prevent reading other accessible sections.
  // Other failures still cancel the snapshot, including incomplete pagination.
  for (const course of courses) {
    for (const [route, kind] of [
      ["file-refs", "file"],
      ["news", "news"],
      ["events", "schedule"],
    ]) {
      try {
        const rows = await client.list(
          `courses/${encodeURIComponent(course.id)}/${route}?page[limit]=100`,
        );
        resources.push(...rows.map((r) => normalize(r, kind, course.id)));
      } catch (error) {
        if (!(error instanceof StudipError) || error.status !== 403)
          throw error;
        unavailableSources.push({ courseId: course.id, kind });
      }
    }
    resources.push({
      id: `course:${course.id}`,
      remoteId: course.id,
      kind: "course",
      courseId: course.id,
      title: course.title,
      description: course.description,
      location: course.location,
    });
  }
  return {
    courses,
    resources,
    unavailableSources,
    semester: current?.attributes?.title || "Все семестры",
  };
}
