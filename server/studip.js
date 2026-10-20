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
  /** @param {import('../shared/studip.js').CourseResource} file @param {import('./types.js').ReadOptions} options */
  async function download(file, { signal, range } = {}) {
    const url = new URL("/sendfile.php", BASE);
    url.search = new URLSearchParams({
      type: "0",
      file_id: file.remoteId,
      file_name: file.title,
      force_download: "1",
    }).toString();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 20000);
    let response;
    try {
      response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, deadline.signal])
          : deadline.signal,
        headers: {
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Cookie: jar ? await jar.getCookieString(url.href) : cookie,
          ...(range && /^bytes=\d+-\d*$/.test(range) ? { Range: range } : {}),
        },
      });
    } catch {
      throw new StudipError(
        "Не удалось скачать файл из Stud.IP. Попробуй ещё раз.",
      );
    } finally {
      // Only waiting for headers is timed out; large files may take longer to stream.
      clearTimeout(timer);
    }
    if (jar)
      for (const value of response.headers.getSetCookie())
        await jar.setCookie(value, url.href);
    let error;
    if (response.status >= 300 && response.status < 400) {
      const target = new URL(response.headers.get("location") || "", url);
      error =
        target.origin === BASE &&
        /(?:login|auth|\/dispatch\.php\/start)/i.test(target.pathname)
          ? new StudipError("Сессия Stud.IP истекла. Войди заново.", 401)
          : new StudipError(
              "Stud.IP перенаправляет скачивание на другой адрес. Этот файл пока недоступен в Stud.GK.",
            );
    } else if (response.status === 401)
      error = new StudipError("Сессия Stud.IP истекла. Войди заново.", 401);
    else if (response.status === 403)
      error = new StudipError("Stud.IP не разрешает скачать этот файл.", 403);
    else if (response.status === 404)
      error = new StudipError("Файл больше не доступен в Stud.IP.", 404);
    else if (!response.ok || !response.body)
      error = new StudipError("Stud.IP не смог отдать файл. Попробуй ещё раз.");
    else if (
      /text\/html/i.test(response.headers.get("content-type") || "") &&
      !response.headers.get("content-disposition")
    ) {
      // Do not save a login page as the requested file.
      await response.body.cancel();
      await get("users/me");
      error = new StudipError("Stud.IP вернул страницу вместо файла.");
    }
    if (error) {
      await response.body?.cancel();
      throw error;
    }
    return response;
  }
  return { get, list, download };
}

const plain = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .trim();
const tones = ["mauve", "blue", "peach", "green", "pink", "teal"];
/** @param {{id: string, attributes?: Record<string, any>, relationships?: Record<string, any>}} resource @param {import('../shared/studip.js').ResourceKind} kind @param {string} courseId @returns {import('../shared/studip.js').CourseResource} */
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

export async function fetchCourseFolders(client, courseId) {
  const course = encodeURIComponent(courseId);
  const [rawFolders, rawFiles] = await Promise.all([
    client.list(`courses/${course}/folders?page[limit]=100`),
    client.list(`courses/${course}/file-refs?page[limit]=100`),
  ]);
  const folders = rawFolders.map((folder) => ({
    id: folder.id,
    title: plain(folder.attributes?.name) || "Без названия",
    parentId: folder.relationships?.parent?.data?.id ?? null,
    readable: folder.attributes?.["is-readable"] !== false,
  }));
  return {
    folders,
    rootId: folders.find((folder) => folder.parentId === null)?.id ?? null,
    fileFolders: rawFiles.map((file) => ({
      fileRefId: file.id,
      folderId: file.relationships?.parent?.data?.id ?? null,
    })),
  };
}

/** @param {ReturnType<typeof createClient>} client @param {import('./types.js').User} user @returns {Promise<import('../shared/studip.js').Snapshot>} */
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
  /** @type {[string, import('../shared/studip.js').ResourceKind][]} */
  const sources = [["file-refs", "file"], ["news", "news"], ["events", "schedule"]];
  for (const course of courses) {
    for (const [route, kind] of sources) {
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
