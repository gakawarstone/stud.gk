import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileVideo,
  FileText,
  GraduationCap,
  GripVertical,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import "./styles.css";

type Course = { id: string; title: string; color: string; url: string | null };
type Change = {
  id: string;
  remoteId?: string;
  resourceId?: string;
  title: string;
  description: string;
  kind: "file" | "news" | "schedule" | "course";
  courseId: string;
  size?: number;
  location?: string;
  occurredAt: string;
  action: "added" | "updated" | "removed";
  read: boolean;
};
type Material = Omit<Change, "occurredAt" | "action" | "read"> & {
  createdAt?: string | null;
  updatedAt?: string | null;
};
type Feed = {
  authenticated: boolean;
  mode: "live" | "demo";
  courses: Course[];
  changes: Change[];
  resources: Material[];
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
  unavailableSources?: { courseId: string; kind: string }[];
  user: { name: string } | null;
};
type AuthState = Feed | { authenticated: false; authExpired: boolean };
type Phase = "loading" | "login" | "live" | "demo";
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new ApiError(
      payload.error || "Не удалось выполнить запрос.",
      response.status,
    );
  return payload;
}
function materialDate(file: Material) {
  return (
    [file.updatedAt, file.createdAt].find(
      (date) => date && Number.isFinite(Date.parse(date)),
    ) || ""
  );
}
function fileAppearance(title: string) {
  const extension = title.includes(".")
    ? title.split(".").pop()!.toLowerCase()
    : "";
  if (extension === "pdf") return { Icon: FileText, label: "PDF", tone: "pdf" };
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].includes(
      extension,
    )
  )
    return { Icon: FileImage, label: extension.toUpperCase(), tone: "image" };
  if (["zip", "rar", "7z", "gz", "tar"].includes(extension))
    return {
      Icon: FileArchive,
      label: extension.toUpperCase(),
      tone: "archive",
    };
  if (["mp3", "ogg", "wav", "m4a", "flac"].includes(extension))
    return { Icon: FileAudio, label: extension.toUpperCase(), tone: "audio" };
  if (["mp4", "webm", "mov", "avi"].includes(extension))
    return { Icon: FileVideo, label: extension.toUpperCase(), tone: "video" };
  if (
    ["js", "ts", "py", "java", "c", "cpp", "html", "css", "json"].includes(
      extension,
    )
  )
    return { Icon: FileCode, label: extension.toUpperCase(), tone: "code" };
  return {
    Icon: FileText,
    label:
      extension && extension.length <= 8 ? extension.toUpperCase() : "Файл",
    tone: "document",
  };
}
function courseFromHash() {
  return new URLSearchParams(window.location.hash.slice(1)).get("course");
}
function fileCountLabel(count: number) {
  const last = count % 10;
  const lastTwo = count % 100;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "файлов"
      : last === 1
        ? "файл"
        : last >= 2 && last <= 4
          ? "файла"
          : "файлов";
  return `${count} ${word}`;
}
function Login({
  error,
  busy,
  onLogin,
  onDemo,
}: {
  error: string | null;
  busy: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onDemo: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onLogin(username, password);
    } finally {
      setPassword("");
    }
  }
  return (
    <div className="login-wrap">
      <section className="login-card">
        <span className="login-symbol">
          <GraduationCap size={29} strokeWidth={1.6} />
        </span>
        <h1>Войти в Stud.IP</h1>
        <p className="login-description">
          Hochschule Flensburg.
          <br />
          Тот же логин и пароль, что и в Stud.IP.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="username">Логин</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Твой логин университета"
            maxLength={128}
            disabled={busy}
            required
            autoFocus
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль Stud.IP"
            maxLength={1024}
            disabled={busy}
            required
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button login-submit"
            type="submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? (
              <>
                <LoaderCircle size={16} className="spin" />
                Входим…
              </>
            ) : (
              <>
                Войти
                <ArrowUpRight size={16} />
              </>
            )}
          </button>
        </form>
        <p className="login-privacy">
          <ShieldCheck size={15} />
          <span>
            Пароль не сохраняется.
            <br />
            Сессия останется на этом компьютере до 7 дней.
          </span>
        </p>
      </section>
      <button className="demo-link" onClick={onDemo} disabled={busy}>
        Посмотреть демо
      </button>
    </div>
  );
}
function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState(courseFromHash);
  const [courseOrder, setCourseOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("campus-course-order") || "[]",
      );
      return Array.isArray(saved)
        ? [
            ...new Set(
              saved.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    } catch {
      return [];
    }
  });
  const [courseDrag, setCourseDrag] = useState<{
    id: string;
    targetId: string | null;
    x: number;
    y: number;
  } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const suppressCardClickUntil = useRef(0);
  const ranks = new Map(courseOrder.map((id, index) => [id, index]));
  const orderedCourses = [...(data?.courses ?? [])].sort(
    (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
  );
  const selectedCourse = orderedCourses.find((c) => c.id === selectedCourseId);
  const fileChanges = (data?.changes ?? []).filter(
    (c) => c.kind === "file" && c.action !== "removed",
  );
  const currentFileIds = new Set(
    (data?.resources ?? []).filter((r) => r.kind === "file").map((r) => r.id),
  );
  const unreadFiles = new Map<string, Change>();
  for (const change of [...fileChanges].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  )) {
    if (
      !change.read &&
      change.resourceId &&
      currentFileIds.has(change.resourceId) &&
      !unreadFiles.has(change.resourceId)
    )
      unreadFiles.set(change.resourceId, change);
  }
  function moveCourse(id: string, targetId: string) {
    const ids = orderedCourses.map((c) => c.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    setCourseOrder(ids);
    localStorage.setItem("campus-course-order", JSON.stringify(ids));
  }
  function startCourseDrag(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary) return;
    const onHandle = (event.target as Element).closest(".course-drag-handle");
    if (event.pointerType !== "mouse" && !onHandle) return;
    dragCleanup.current?.();
    const { clientX: startX, clientY: startY, pointerId } = event;
    let started = false;
    let targetId: string | null = null;
    function move(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (!started && Math.hypot(e.clientX - startX, e.clientY - startY) < 6)
        return;
      started = true;
      e.preventDefault();
      targetId =
        document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-course-id]")?.dataset.courseId || null;
      setCourseDrag({ id, targetId, x: e.clientX, y: e.clientY });
      if (e.clientY < 60) window.scrollBy(0, -20);
      else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 20);
    }
    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      dragCleanup.current = null;
      setCourseDrag(null);
      if (started) suppressCardClickUntil.current = Date.now() + 400;
    }
    function end(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (started && targetId) moveCourse(id, targetId);
      cleanup();
    }
    function cancel() {
      cleanup();
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") cleanup();
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    dragCleanup.current = cleanup;
  }
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    function navigate() {
      dragCleanup.current?.();
      setSelectedCourseId(courseFromHash());
      setFileError(null);
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const previousSync = useRef<string | null>(null);
  function signedOut(message: string | null = null) {
    dragCleanup.current?.();
    generation.current++;
    previousSync.current = null;
    setData(null);
    setFileError(null);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    setSelectedCourseId(null);
    setPhase("login");
    setError(message);
  }
  async function load() {
    const version = generation.current;
    try {
      const next =
        phaseRef.current === "demo"
          ? await api<Feed>("/api/demo")
          : await api<AuthState>("/api/state");
      if (version !== generation.current) return;
      if (!next.authenticated && !("mode" in next)) {
        setData(null);
        setPhase("login");
        if (next.authExpired)
          setError("Сессия истекла. Войди в Stud.IP заново.");
        return;
      }
      const feed = next as Feed;
      if (
        previousSync.current &&
        feed.mode === "live" &&
        feed.lastSync !== previousSync.current &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        localStorage.getItem("campus-notifications") === "true"
      ) {
        const fresh = feed.changes.filter(
          (c) =>
            !c.read &&
            c.kind === "file" &&
            c.action !== "removed" &&
            Date.parse(c.occurredAt) > Date.parse(previousSync.current!),
        );
        if (fresh.length)
          new Notification("Campus · Новые изменения", {
            body: `${fresh.length} обновлений в твоих курсах.`,
            icon: "/favicon.svg",
          });
      }
      previousSync.current = feed.lastSync;
      setData(feed);
      setPhase(feed.mode);
      setError(null);
    } catch (e) {
      if (version !== generation.current) return;
      setError((e as Error).message);
      if (phaseRef.current === "loading") setPhase("login");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (phase === "loading" || phase === "demo") return;
    const timer = setInterval(
      () => {
        void load();
      },
      data?.syncing ? 2000 : 30000,
    );
    return () => clearInterval(timer);
  }, [phase, data?.syncing]);
  useEffect(() => {
    const unread = unreadFiles.size;
    document.title = `${unread ? `(${unread}) ` : ""}Campus · ${selectedCourse?.title || "Курсы"}`;
  }, [data, selectedCourse?.title]);
  async function login(username: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { username, password });
      generation.current++;
      previousSync.current = null;
      phaseRef.current = "live";
      setPhase("loading");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showDemo() {
    generation.current++;
    previousSync.current = null;
    phaseRef.current = "demo";
    setError(null);
    setPhase("loading");
    await load();
  }
  async function logout() {
    setBusy(true);
    try {
      await api("/api/auth/logout", {});
      signedOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError(null);
    setFileError(null);
    try {
      if (phase === "live") await api("/api/sync", {});
      await load();
    } catch (e) {
      if ((e as ApiError).status === 401)
        signedOut("Сессия истекла. Войди в Stud.IP заново.");
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const allFiles = (data?.resources ?? []).filter((r) => r.kind === "file");
  const files = allFiles
    .filter((f) => f.courseId === selectedCourse?.id)
    .sort(
      (a, b) =>
        (materialDate(b) ? Date.parse(materialDate(b)) : -Infinity) -
          (materialDate(a) ? Date.parse(materialDate(a)) : -Infinity) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
  const syncError = error || data?.error;
  const partial = Boolean(
    selectedCourse &&
      data?.unavailableSources?.some(
        (s) => s.courseId === selectedCourse.id && s.kind === "file",
      ),
  );
  const syncing = busy || data?.syncing;
  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <GraduationCap size={24} strokeWidth={1.7} />
          <span>campus</span>
        </div>
        {(phase === "live" || phase === "demo") && (
          <div className="account">
            {phase === "demo" ? (
              <>
                <span className="demo-badge">Демо</span>
                <button className="text-button" onClick={() => signedOut()}>
                  Войти
                </button>
              </>
            ) : (
              <>
                <span className="account-name">{data?.user?.name}</span>
                <button
                  className="text-button"
                  onClick={() => void logout()}
                  disabled={busy}
                >
                  <LogOut size={15} />
                  Выйти
                </button>
              </>
            )}
          </div>
        )}
      </header>
      {phase === "loading" ? (
        <div className="loading">
          <LoaderCircle size={24} className="spin" />
          Загружаем…
        </div>
      ) : phase === "login" ? (
        <Login
          error={error}
          busy={busy}
          onLogin={login}
          onDemo={() => void showDemo()}
        />
      ) : (
        <main className="feed-main">
          {selectedCourse ? (
            <nav className="course-path" aria-label="Навигация по курсам">
              <a className="back-to-courses" href="#">
                <ArrowLeft size={16} /> Все курсы
              </a>
              <ChevronRight className="path-separator" size={16} />
              <h1 className="course-heading">{selectedCourse.title}</h1>
            </nav>
          ) : (
            <h1 className="visually-hidden">Курсы</h1>
          )}
          {(syncError || fileError) && (
            <div className="feed-error" role="alert">
              {syncError || fileError}
            </div>
          )}
          {selectedCourse && partial && !syncError && !fileError && (
            <div className="feed-warning" role="status">
              <TriangleAlert size={13} />
              Часть файлов недоступна в Stud.IP.
            </div>
          )}
          {!selectedCourse && (
            <p id="course-sort-help" className="visually-hidden">
              Перетащи карточку за ручку, чтобы изменить порядок. На клавиатуре
              используй стрелки на ручке.
            </p>
          )}
          {courseDrag && (
            <div
              className="course-drag-preview"
              aria-hidden="true"
              style={{
                left: Math.max(
                  8,
                  Math.min(courseDrag.x + 14, window.innerWidth - 248),
                ),
                top: Math.max(
                  8,
                  Math.min(courseDrag.y + 14, window.innerHeight - 90),
                ),
              }}
            >
              <GripVertical size={16} />
              {data?.courses.find((c) => c.id === courseDrag.id)?.title}
            </div>
          )}
          <section
            className={selectedCourse ? "file-grid" : "course-grid"}
            aria-label={selectedCourse ? "Файлы курса" : "Курсы"}
          >
            {!selectedCourse &&
              orderedCourses.map((course) => {
                const count = allFiles.filter(
                  (f) => f.courseId === course.id,
                ).length;
                const newCount = allFiles.filter(
                  (f) => f.courseId === course.id && unreadFiles.has(f.id),
                ).length;
                const unavailable = data?.unavailableSources?.some(
                  (s) => s.courseId === course.id && s.kind === "file",
                );
                return (
                  <article
                    className={`course-card ${course.color || "mauve"} ${courseDrag?.id === course.id ? "dragging" : ""} ${courseDrag?.targetId === course.id && courseDrag.id !== course.id ? "drop-target" : ""}`}
                    key={course.id}
                    data-course-id={course.id}
                    onPointerDown={(event) => startCourseDrag(event, course.id)}
                    onDragStart={(event) => event.preventDefault()}
                    onClickCapture={(event) => {
                      if (Date.now() < suppressCardClickUntil.current) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                  >
                    <a
                      className="course-card-link"
                      href={`#${new URLSearchParams({ course: course.id })}`}
                      draggable={false}
                    >
                      <div className="course-card-top">
                        <span className="course-card-icon">
                          <GraduationCap size={24} strokeWidth={1.6} />
                        </span>
                      </div>
                      <h2>{course.title}</h2>
                      <div className="course-card-meta">
                        <span>
                          <FileText size={14} /> {fileCountLabel(count)}
                        </span>
                        {newCount > 0 && (
                          <span className="course-new-count">
                            Обновлений: {newCount}
                          </span>
                        )}
                      </div>
                      {unavailable && (
                        <p className="course-card-warning">
                          <TriangleAlert size={13} /> Часть файлов недоступна
                        </p>
                      )}
                    </a>
                    <button
                      className="course-drag-handle"
                      aria-label={`Изменить порядок: ${course.title}`}
                      aria-describedby="course-sort-help"
                      title="Перетащить курс"
                      onKeyDown={(event) => {
                        const direction =
                          event.key === "ArrowUp" || event.key === "ArrowLeft"
                            ? -1
                            : event.key === "ArrowDown" ||
                                event.key === "ArrowRight"
                              ? 1
                              : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const target =
                          orderedCourses[
                            orderedCourses.findIndex(
                              (c) => c.id === course.id,
                            ) + direction
                          ];
                        if (target) {
                          const handle = event.currentTarget;
                          moveCourse(course.id, target.id);
                          requestAnimationFrame(() => handle.focus());
                        }
                      }}
                    >
                      <GripVertical size={18} />
                    </button>
                  </article>
                );
              })}
            {selectedCourse &&
              files.map((file) => {
                const { Icon, label, tone } = fileAppearance(file.title);
                const date = materialDate(file);
                const unread = unreadFiles.get(file.id);
                const body = (
                  <>
                    <div className={`file-preview ${tone}`}>
                      <Icon size={44} strokeWidth={1.4} />
                      <span className="file-type">{label}</span>
                      {unread && (
                        <span className={`file-status ${unread.action}`}>
                          <i />
                          {unread.action === "added" ? "Новый" : "Обновлён"}
                        </span>
                      )}
                    </div>
                    <div className="file-info">
                      <h2>{file.title}</h2>
                      <div className="file-meta">
                        <span>
                          {file.size == null
                            ? "Размер неизвестен"
                            : file.size >= 1000000
                              ? `${(file.size / 1000000).toFixed(1)} МБ`
                              : `${Math.round(file.size / 1000)} КБ`}
                        </span>
                        {date && (
                          <time dateTime={date}>
                            {new Date(date).toLocaleDateString("ru-RU", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </time>
                        )}
                      </div>
                    </div>
                  </>
                );
                return (
                  <article
                    className={`file-card ${unread ? "unread" : ""}`}
                    key={file.id}
                  >
                    {phase === "live" && file.remoteId ? (
                      <a
                        className="file-card-link"
                        aria-label={`Открыть ${file.title}`}
                        href={`/api/files/${encodeURIComponent(file.remoteId)}/preview`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setFileError(null)}
                      >
                        {body}
                      </a>
                    ) : (
                      <button
                        className="file-card-link"
                        aria-label={`Открыть ${file.title}`}
                        onClick={() =>
                          setFileError(
                            phase === "demo"
                              ? "В демо просмотр файлов недоступен."
                              : "У файла нет ссылки для просмотра.",
                          )
                        }
                      >
                        {body}
                      </button>
                    )}
                  </article>
                );
              })}
            {(selectedCourse ? !files.length : !orderedCourses.length) && (
              <div className="empty">
                <span>
                  {data?.syncing ? (
                    <LoaderCircle className="spin" size={28} />
                  ) : syncError || !data?.lastSync ? (
                    <TriangleAlert size={28} />
                  ) : (
                    <FileText size={28} />
                  )}
                </span>
                <h2>
                  {data?.syncing
                    ? "Собираем твои курсы"
                    : syncError || !data?.lastSync
                      ? "Не удалось проверить курсы"
                      : selectedCourse
                        ? "Файлов пока нет"
                        : "Курсов пока нет"}
                </h2>
                <p>
                  {data?.syncing ? (
                    "Это может занять немного времени."
                  ) : syncError || !data?.lastSync ? (
                    <button
                      className="empty-link"
                      onClick={() => void refresh()}
                      disabled={syncing}
                    >
                      Повторить проверку
                    </button>
                  ) : selectedCourse ? (
                    "В доступных разделах файлов нет."
                  ) : (
                    "Курсы появятся здесь после проверки Stud.IP."
                  )}
                </p>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
