import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  FileText,
  GraduationCap,
  LoaderCircle,
  LogOut,
  Megaphone,
  RefreshCw,
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
function day(date: string) {
  const value = new Date(date),
    today = new Date(),
    yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (value.toDateString() === today.toDateString()) return "Сегодня";
  if (value.toDateString() === yesterday.toDateString()) return "Вчера";
  return value.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(value.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}
function lastSync(date: string | null) {
  if (!date) return "Курсы ещё не проверены";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  return minutes === 0
    ? "Обновлено только что"
    : minutes < 60
      ? `Обновлено ${minutes} мин. назад`
      : `Обновлено ${new Date(date).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
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
  const [view, setView] = useState<"files" | "updates">(() =>
    localStorage.getItem("campus-view") === "updates" ? "updates" : "files",
  );
  function selectView(next: "files" | "updates") {
    setView(next);
    localStorage.setItem("campus-view", next);
  }
  const generation = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const previousSync = useRef<string | null>(null);
  function signedOut(message: string | null = null) {
    generation.current++;
    previousSync.current = null;
    setData(null);
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
    const unread = data?.changes.filter((c) => !c.read).length || 0;
    document.title = unread
      ? `(${unread}) Campus · Обновления`
      : "Campus · Stud.IP";
  }, [data]);
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
  async function markRead(change: Change) {
    if (change.read) return;
    setData((current) =>
      current
        ? {
            ...current,
            changes: current.changes.map((c) =>
              c.id === change.id ? { ...c, read: true } : c,
            ),
          }
        : current,
    );
    if (phase === "demo") return;
    try {
      await api("/api/changes/read", { id: change.id });
    } catch (e) {
      if ((e as ApiError).status === 401)
        signedOut("Сессия истекла. Войди в Stud.IP заново.");
      else {
        setError((e as Error).message);
        void load();
      }
    }
  }
  function markEntryRead(entry: Change) {
    if (view === "updates") void markRead(entry);
    else
      for (const change of data?.changes ?? []) {
        if (change.resourceId === entry.id && !change.read)
          void markRead(change);
      }
  }
  const files = (data?.resources ?? []).filter((r) => r.kind === "file");
  const groups = new Map<string, Change[]>();
  if (view === "files") {
    const entries: Change[] = files
      .map<Change>((f) => {
        const date = [f.updatedAt, f.createdAt].find(
          (d) => d && Number.isFinite(Date.parse(d)),
        );
        return { ...f, occurredAt: date || "", action: "added", read: true };
      })
      .sort(
        (a, b) =>
          (b.occurredAt ? Date.parse(b.occurredAt) : -Infinity) -
            (a.occurredAt ? Date.parse(a.occurredAt) : -Infinity) ||
          a.title.localeCompare(b.title, undefined, { numeric: true }) ||
          a.id.localeCompare(b.id),
      );
    if (entries.length) groups.set("files", entries);
  } else {
    [...(data?.changes ?? [])]
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .forEach((change) => {
        const label = day(change.occurredAt);
        groups.set(label, [...(groups.get(label) ?? []), change]);
      });
  }
  const unread = data?.changes.filter((c) => !c.read).length || 0;
  const syncError = error || data?.error;
  const partial = Boolean(data?.unavailableSources?.length);
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
          <div className="feed-heading">
            <div>
              <h1>{view === "files" ? "Файлы" : "Обновления"}</h1>
            </div>
            <button
              className="refresh-button"
              aria-label={busy || data?.syncing ? "Обновляем…" : "Обновить"}
              disabled={busy || data?.syncing}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={16}
                className={busy || data?.syncing ? "spin" : ""}
              />
              <span>{busy || data?.syncing ? "Обновляем…" : "Обновить"}</span>
            </button>
          </div>
          <div className="view-switch" role="group" aria-label="Показать">
            <button
              aria-pressed={view === "files"}
              onClick={() => selectView("files")}
            >
              Все файлы <span>{files.length}</span>
            </button>
            <button
              aria-pressed={view === "updates"}
              onClick={() => selectView("updates")}
            >
              Обновления {unread > 0 && <span>{unread}</span>}
            </button>
          </div>
          {syncError && (
            <div className="feed-error" role="alert">
              {syncError}
            </div>
          )}
          {partial && !syncError && (
            <div className="feed-warning" role="status">
              Часть материалов недоступна в Stud.IP.
            </div>
          )}
          <div className="sync-status">
            <span
              className={`status-dot ${data?.syncing ? "updating" : syncError ? "failed" : partial ? "updating" : !data?.lastSync ? "inactive" : ""}`}
            />
            {data?.syncing
              ? "Проверяем курсы…"
              : syncError
                ? "Проверка не завершена"
                : lastSync(data?.lastSync ?? null)}
          </div>
          <section
            className={`feed ${view === "files" ? "files-feed" : ""}`}
            aria-label={view === "files" ? "Все файлы" : "Лента обновлений"}
          >
            {[...groups].map(([label, changes]) => (
              <div className="day-group" key={label}>
                {view === "updates" && (
                  <h2>
                    {label}
                    <span />
                  </h2>
                )}
                {changes.map((change) => {
                  const course = data?.courses.find(
                    (c) => c.id === change.courseId,
                  );
                  const Icon =
                    change.kind === "file"
                      ? FileText
                      : change.kind === "news"
                        ? Megaphone
                        : change.kind === "schedule"
                          ? CalendarDays
                          : GraduationCap;
                  const action =
                    change.action === "removed"
                      ? "Исчезло из курса"
                      : change.action === "updated"
                        ? "Обновлено"
                        : change.kind === "file"
                          ? "Новый файл"
                          : change.kind === "news"
                            ? "Объявление"
                            : "Добавлено";
                  const body = (
                    <>
                      <span className={`entry-icon ${change.kind}`}>
                        <Icon size={20} strokeWidth={1.6} />
                      </span>
                      <div className="entry-body">
                        {view === "updates" && (
                          <div className="entry-course">
                            <i className={course?.color || "mauve"} />
                            {course?.title || "Курс"}
                          </div>
                        )}
                        <h3>
                          {change.title}
                          {!change.read && <i className="new-dot" />}
                        </h3>
                        {change.kind !== "file" && change.description && (
                          <p className="entry-description">
                            {change.description.length > 240
                              ? `${change.description.slice(0, 240)}…`
                              : change.description}
                          </p>
                        )}
                        <div className="entry-meta">
                          {view === "updates" && (
                            <span className={change.action}>{action}</span>
                          )}
                          {change.kind === "file" && (
                            <>
                              {view === "updates" && <i />}
                              {(change.size || 0) >= 1000000
                                ? `${((change.size || 0) / 1000000).toFixed(1)} МБ`
                                : `${Math.round((change.size || 0) / 1000)} КБ`}
                            </>
                          )}
                          {change.location && (
                            <>
                              <i />
                              {change.location}
                            </>
                          )}
                          {view === "files" && course && (
                            <>
                              <i />
                              <span
                                className="file-course"
                                title={course.title}
                              >
                                {course.title}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {change.occurredAt && (
                        <time dateTime={change.occurredAt}>
                          {new Date(change.occurredAt).toLocaleString(
                            "ru-RU",
                            view === "files"
                              ? {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                }
                              : { hour: "2-digit", minute: "2-digit" },
                          )}
                        </time>
                      )}
                      {phase === "live" && (
                        <ArrowUpRight className="entry-open" size={16} />
                      )}
                    </>
                  );
                  return (
                    <article
                      key={change.id}
                      className={`entry ${change.read ? "read" : "unread"}`}
                    >
                      {phase === "live" ? (
                        <a
                          className="entry-link"
                          href={
                            change.kind === "file" &&
                            change.action !== "removed" &&
                            change.remoteId
                              ? `https://elearning.hs-flensburg.de/dispatch.php/file/details/${encodeURIComponent(change.remoteId)}?cid=${encodeURIComponent(change.courseId)}`
                              : course?.url ||
                                `https://elearning.hs-flensburg.de/dispatch.php/course/overview?cid=${encodeURIComponent(change.courseId)}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => markEntryRead(change)}
                        >
                          {body}
                        </a>
                      ) : (
                        <button
                          className="entry-link"
                          onClick={() => markEntryRead(change)}
                        >
                          {body}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}
            {!groups.size && (
              <div className="empty">
                <span>
                  {data?.syncing ? (
                    <LoaderCircle className="spin" size={28} />
                  ) : syncError || !data?.lastSync ? (
                    <TriangleAlert size={28} />
                  ) : (
                    <Check size={28} />
                  )}
                </span>
                <h2>
                  {data?.syncing
                    ? "Собираем твои курсы"
                    : syncError || !data?.lastSync
                      ? "Не удалось проверить курсы"
                      : view === "files"
                        ? "Файлов пока нет"
                        : "Пока без изменений"}
                </h2>
                <p>
                  {data?.syncing ? (
                    "Это может занять немного времени."
                  ) : syncError || !data?.lastSync ? (
                    "Нажми «Обновить», чтобы повторить проверку."
                  ) : view === "files" ? (
                    "В доступных разделах файлов нет."
                  ) : (
                    <button
                      className="empty-link"
                      onClick={() => selectView("files")}
                    >
                      Посмотреть все файлы
                    </button>
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
