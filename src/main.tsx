import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  BellDot,
  ChevronRight,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileVideo,
  FileText,
  FolderTree,
  GraduationCap,
  GripVertical,
  LoaderCircle,
  LayoutGrid,
  LogOut,
  TriangleAlert,
} from "lucide-react";
import "./styles.css";
import { FileThumbnail } from "./FileThumbnail";
import { PdfViewer } from "./PdfViewer";
import { courseIcon } from "./course-icons";
import { listFolder, type CourseFolders } from "./course-folders";
import { FolderExplorer } from "./FolderExplorer";
import { PdfFileIcon } from "./PdfFileIcon";
import { CourseSidebar } from "./CourseSidebar";
import { GitlabProject } from "./GitlabProject";
import { NextcloudSection } from "./NextcloudSection";
import { CourseSections } from "./CourseSections";
import { courseTabFromHash, courseTabLink } from "./course-tabs";

import { api, ApiError } from "./api";
import { Login } from "./Login";
import { useCourseOrder } from "./use-course-order";
import { useFeedSession } from "./use-feed-session";
import type { Change, Material } from "../shared/studip";

function userInitials(name: string | undefined) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .filter((_, index) => index === 0 || index === parts.length - 1)
      .map((part) => Array.from(part)[0])
      .join("")
      .toLocaleUpperCase() || "?"
  );
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
  if (extension === "pdf") return { Icon: PdfFileIcon, label: "PDF", tone: "pdf" };
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
function folderFromHash() {
  return new URLSearchParams(window.location.hash.slice(1)).get("folder");
}
function folderLink(courseId: string, folderId?: string) {
  return `#${new URLSearchParams({ course: courseId, ...(folderId ? { folder: folderId } : {}) })}`;
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
function App() {
  const {
    phase, data, busy, error, generation, load, signedOut,
    login, showDemo, logout, refresh: refreshFeed, markResourceViewed, saveGitlabProject: saveProject,
  } = useFeedSession(resetSessionUi);
  const [fileError, setFileError] = useState<string | null>(null);
  const [viewedPdf, setViewedPdf] = useState<Material | null>(null);
  const [nextcloudToolbar, setNextcloudToolbar] = useState<HTMLDivElement | null>(null);
  const [gitlabToolbar, setGitlabToolbar] = useState<HTMLDivElement | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState(courseFromHash);
  const [selectedTab, setSelectedTab] = useState(() => courseTabFromHash());
  const [selectedFolderId, setSelectedFolderId] = useState(folderFromHash);
  const [fileView, setFileView] = useState<"all" | "folders">(() => {
    if (folderFromHash()) return "folders";
    try {
      return localStorage.getItem("stud-gk-file-view") === "folders" ? "folders" : "all";
    } catch {
      return "all";
    }
  });
  const [folderRevision, setFolderRevision] = useState(0);
  const initialFolderCourse = useRef<string | null>(null);
  const [folderState, setFolderState] = useState<{
    courseId: string;
    data: CourseFolders | null;
    error: string | null;
  } | null>(null);
  const { orderedCourses, courseDrag, moveCourse, startCourseDrag, suppressCardClickUntil, cancelCourseDrag } = useCourseOrder(data?.courses ?? []);
  const selectedCourse = orderedCourses.find((c) => c.id === selectedCourseId);
  const courseSettingsScope = JSON.stringify([phase, data?.user?.id || "", selectedCourse?.id || ""]);
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
  useEffect(() => {
    function navigate() {
      cancelCourseDrag();
      setSelectedCourseId(courseFromHash());
      setSelectedTab(courseTabFromHash());
      setSelectedFolderId(folderFromHash());
      if (folderFromHash()) setFileView("folders");
      setFileError(null);
      setViewedPdf(null);
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("stud-gk-file-view", fileView);
    } catch { /* The current view still works when storage is unavailable. */ }
  }, [fileView]);
  useEffect(() => {
    const courseId = selectedCourse?.id;
    if (!courseId || selectedTab !== "files" || fileView !== "folders" || (phase !== "live" && phase !== "demo")) return;
    let cancelled = false;
    const controller = new AbortController();
    const version = generation.current;
    setFolderState({ courseId, data: null, error: null });
    const route = phase === "demo" ? "/api/demo/courses" : "/api/courses";
    void api<CourseFolders>(`${route}/${encodeURIComponent(courseId)}/folders`, undefined, controller.signal)
      .then((folders) => {
        if (!cancelled && version === generation.current) {
          setFolderState({ courseId, data: folders, error: null });
          if (initialFolderCourse.current !== courseId) {
            initialFolderCourse.current = courseId;
            const root = listFolder(folders, null, (data?.resources ?? [])
              .filter((file) => file.kind === "file" && file.courseId === courseId));
            const first = root.folders.find((folder) => folder.readable);
            if (!folderFromHash() && !root.files.length && first) {
              window.history.replaceState(null, "", folderLink(courseId, first.id));
              setSelectedFolderId(first.id);
            }
          }
        }
      })
      .catch((error) => {
        if (cancelled || version !== generation.current) return;
        if (error instanceof ApiError && error.status === 401) {
          signedOut("Сессия истекла. Войди в Stud.IP заново.");
          return;
        }
        setFolderState({
          courseId, data: null,
          error: error instanceof ApiError ? error.message : "Не удалось загрузить папки. Попробуй ещё раз.",
        });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [selectedCourse?.id, selectedTab, fileView, phase, data?.lastSync, folderRevision]);
  function resetSessionUi() {
    setViewedPdf(null);
    cancelCourseDrag();
    setFolderState(null);
    initialFolderCourse.current = null;
    setFileError(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setSelectedCourseId(null);
    setSelectedTab("files");
    setSelectedFolderId(null);
  }
  useEffect(() => {
    const unread = unreadFiles.size;
    document.title = `${unread ? `(${unread}) ` : ""}Stud.GK · ${selectedCourse?.title || "Курсы"}`;
  }, [data, selectedCourse?.title]);
  async function refresh() {
    setFileError(null);
    await refreshFeed();
  }
  async function saveGitlabProject(url: string | null) {
    if (selectedCourse) await saveProject(selectedCourse.id, url);
  }
  const allFiles = (data?.resources ?? []).filter((r) => r.kind === "file");
  const courseFiles = allFiles
    .filter((f) => f.courseId === selectedCourse?.id)
    .sort(
      (a, b) =>
        (materialDate(b) ? Date.parse(materialDate(b)) : -Infinity) -
          (materialDate(a) ? Date.parse(materialDate(a)) : -Infinity) ||
        a.title.localeCompare(b.title, undefined, { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
  const folderData = folderState?.courseId === selectedCourse?.id ? folderState?.data : null;
  const folderError = folderState?.courseId === selectedCourse?.id ? folderState?.error : null;
  const folderListing = folderData ? listFolder(folderData, selectedFolderId, courseFiles) : null;
  const folders = fileView === "folders" ? folderListing?.folders ?? [] : [];
  const files = fileView === "folders" ? folderListing?.files ?? [] : courseFiles;
  const linkedProject = selectedCourse && data?.gitlabProjects && Object.hasOwn(data.gitlabProjects, selectedCourse.id)
    ? data.gitlabProjects[selectedCourse.id] : null;
  function changeFileView(view: "all" | "folders") {
    if (view === "folders" && fileView !== "folders") initialFolderCourse.current = null;
    setFileView(view);
    setFileError(null);
    setViewedPdf(null);
    if (view === "all" && selectedCourse && folderFromHash()) {
      window.history.replaceState(null, "", folderLink(selectedCourse.id));
      setSelectedFolderId(null);
    }
  }
  const syncError = error || data?.error;
  const partial = Boolean(
    selectedCourse &&
      data?.unavailableSources?.some(
        (s) => s.courseId === selectedCourse.id && s.kind === "file",
      ),
  );
  const syncing = busy || data?.syncing;
  return (
    <div className={`page${selectedCourse ? " page--course" : ""}`}>
      <header className={`header${selectedCourse ? " header--course" : ""}`}>
        <div className="brand" role="img" aria-label="Stud.GK">
          <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
            <g fill="none" strokeWidth="8" strokeLinecap="butt" strokeLinejoin="round">
              <path d="M48 14H25.657Q24 14 22.828 15.172L16.828 21.172Q14 24 17.655 25.625L24.858 28.826" stroke="currentColor" />
              <path d="M27.142 29.841L36.858 34.159" stroke="var(--peach)" />
              <path d="M39.142 35.174L46.345 38.375Q50 40 47.172 42.828L41.172 48.828Q40 50 38.343 50H16" stroke="var(--sky)" />
            </g>
            <circle cx="48" cy="14" r="5" />
            <circle cx="16" cy="50" r="5" fill="var(--sky)" />
          </svg>
          <span aria-hidden="true">tud.GK</span>
        </div>
        {selectedCourse && (
          <div className="course-toolbar">
            <nav className="course-path" aria-label="Навигация по курсам">
              <a className="back-to-courses" href="#">
                <ArrowLeft size={16} /> Все курсы
              </a>
              <ChevronRight className="path-separator" size={16} />
              <h1 className="course-heading" title={selectedCourse.title}>
                {selectedTab === "files" && fileView === "folders" ? (
                  <a href={folderLink(selectedCourse.id)}>{selectedCourse.title}</a>
                ) : selectedCourse.title}
              </h1>
            </nav>
            {selectedTab === "files" && <div className="file-view-switch" role="group" aria-label="Вид файлов">
              <button type="button" aria-pressed={fileView === "all"}
                aria-label="Все файлы" title="Все файлы"
                onClick={() => changeFileView("all")}>
                <LayoutGrid size={15} aria-hidden="true" />
              </button>
              <button type="button" aria-pressed={fileView === "folders"}
                aria-label="Папки" title="Папки"
                onClick={() => changeFileView("folders")}>
                <FolderTree size={15} aria-hidden="true" />
              </button>
            </div>}
            {selectedTab === "nextcloud" && <div className="nextcloud-toolbar" ref={setNextcloudToolbar} />}
            {selectedTab === "gitlab" && <div className="gitlab-toolbar" ref={setGitlabToolbar} />}
          </div>
        )}
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
                <button
                  className="account-button"
                  onClick={() => void logout()}
                  disabled={busy}
                  aria-label={`Выйти из аккаунта ${data?.user?.name || ""}`}
                  title={`Выйти из аккаунта ${data?.user?.name || ""}`}
                >
                  <span className="account-name">
                    {userInitials(data?.user?.name)}
                  </span>
                  <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
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
        <main className={`feed-main${selectedCourse ? " feed-main--course" : ""}`}>
          {!selectedCourse && <h1 className="visually-hidden">Курсы</h1>}
          {(syncError || fileError) && (
            <div className="feed-error" role="alert">
              {syncError || fileError}
            </div>
          )}
          {selectedCourse && selectedTab === "files" && partial && !syncError && !fileError && (
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
          <div className={selectedCourse ? "course-workspace" : undefined}>
            {selectedCourse && <CourseSidebar
              key={courseSettingsScope}
              storageKey={`stud-gk-course-tabs:${courseSettingsScope}`}
              activeTab={selectedTab}
              unreadNews={(data?.changes ?? []).some((change) => change.courseId === selectedCourse.id && change.kind === "news" && !change.read && change.action !== "removed" && data?.resources.some((item) => item.id === change.resourceId))}
              onSelect={(tab) => { window.location.hash = courseTabLink(selectedCourse.id, tab, selectedFolderId); }}
            />}
            <div className={selectedCourse ? "course-content" : undefined}>
            {selectedCourse && selectedTab !== "files" ? selectedTab === "gitlab" ? <GitlabProject
              key={`${phase}:${selectedCourse.id}`} courseId={selectedCourse.id}
              project={linkedProject} demo={phase === "demo"} onSave={saveGitlabProject} toolbarTarget={gitlabToolbar}
            /> : selectedTab === "nextcloud" ? <NextcloudSection
              key={courseSettingsScope} storageKey={`stud-gk-nextcloud:${courseSettingsScope}`} toolbarTarget={nextcloudToolbar}
            /> : <CourseSections
              key={`${selectedCourse.id}:${selectedTab}`}
              course={selectedCourse} tab={selectedTab} resources={data?.resources ?? []}
              unavailable={Boolean(data?.unavailableSources?.some((source) => source.courseId === selectedCourse.id && source.kind === selectedTab))}
              onRead={(id) => void markResourceViewed(id)}
            /> : <div className={selectedCourse && fileView === "folders" && folderData ? "course-explorer" : undefined}>
            {selectedCourse && fileView === "folders" && folderData && (
              <FolderExplorer key={selectedCourse.id} data={folderData}
                currentId={folderListing?.currentId ?? null} courseId={selectedCourse.id} />
            )}
          <section
            className={selectedCourse ? fileView === "folders" ? "explorer-files" : "file-grid" : "course-grid"}
            aria-label={selectedCourse ? fileView === "folders" ? "Папки и файлы курса" : "Файлы курса" : "Курсы"}
          >
            {selectedCourse && fileView === "folders" && !folderListing && (
              <div className="empty" role="status">
                {folderError ? <TriangleAlert size={28} /> : <LoaderCircle className="spin" size={28} />}
                <h2>{folderError ? "Не удалось загрузить папки" : "Загружаем папки…"}</h2>
                {folderError && <>
                  <p>{folderError}</p>
                  <button className="empty-link" onClick={() => setFolderRevision((value) => value + 1)}>Повторить</button>
                </>}
              </div>
            )}
            {!selectedCourse &&
              orderedCourses.map((course) => {
                const CourseIcon = courseIcon(course.title);
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
                        <span className="course-card-icon" aria-hidden="true">
                          <CourseIcon size={24} strokeWidth={1.6} />
                        </span>
                        <h2 title={course.title}>{course.title}</h2>
                      </div>
                      <div className="course-card-footer">
                        <div className="course-card-meta">
                          <span
                            className="course-file-count"
                            role="img"
                            aria-label={fileCountLabel(count)}
                            title={fileCountLabel(count)}
                          >
                            <FileText size={14} aria-hidden="true" /> {count}
                          </span>
                          {newCount > 0 && (
                            <span
                              className="course-new-count"
                              role="img"
                              aria-label={`Обновлений: ${newCount}`}
                              title={`Обновлений: ${newCount}`}
                            >
                              <BellDot size={14} aria-hidden="true" /> {newCount}
                            </span>
                          )}
                          {unavailable && (
                            <span
                              className="course-card-warning"
                              role="img"
                              aria-label="Часть файлов недоступна"
                              title="Часть файлов недоступна"
                            >
                              <TriangleAlert size={14} aria-hidden="true" />
                            </span>
                          )}
                        </div>
                      </div>
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
                const previewLabel = `Открыть ${file.title}${unread ? (unread.action === "added" ? ". Новый файл" : ". Обновлённый файл") : ""}`;
                const body = (
                  <>
                    {fileView === "folders" ? (
                      <span className="explorer-file-icon"><Icon size={tone === "pdf" ? 20 : 18} strokeWidth={1.6} aria-hidden="true" /></span>
                    ) : phase === "live" &&
                    file.remoteId &&
                    (tone === "pdf" || tone === "image") ? (
                      <FileThumbnail
                        url={`/api/files/${encodeURIComponent(file.remoteId)}/content`}
                        version={`${generation.current}:${file.updatedAt || file.createdAt || ""}`}
                        kind={tone}
                      />
                    ) : (
                      <div className={`file-preview ${tone}`}>
                        <Icon size={44} strokeWidth={1.4} />
                        <span className="file-type">{label}</span>
                      </div>
                    )}
                    <div className="file-info">
                      <h2 title={file.title}>{file.title}</h2>
                      <div className="file-meta">
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
                    {phase === "live" && file.remoteId && tone === "pdf" ? (
                      <button
                        className="file-card-link"
                        aria-label={previewLabel}
                        aria-haspopup="dialog"
                        onClick={() => {
                          setFileError(null);
                          setViewedPdf(file);
                        }}
                      >
                        {body}
                      </button>
                    ) : phase === "live" && file.remoteId ? (
                      <a
                        className="file-card-link"
                        aria-label={previewLabel}
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
                        aria-label={previewLabel}
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
            {(selectedCourse ? !files.length && (fileView === "all" || Boolean(folderListing)) : !orderedCourses.length) && (
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
                        ? fileView === "folders" ? folders.length ? "Выбери вложенную папку" : "Папка пуста" : "Файлов пока нет"
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
                    fileView === "folders" ? folders.length ? "Вложенные папки находятся в списке слева." : "В этой папке пока нет доступных файлов." : "В доступных разделах файлов нет."
                  ) : (
                    "Курсы появятся здесь после проверки Stud.IP."
                  )}
                </p>
              </div>
            )}
          </section>
          </div>}
            </div>
          </div>
        </main>
      )}
      {phase === "live" && viewedPdf?.remoteId && (
        <PdfViewer
          key={viewedPdf.id}
          title={viewedPdf.title}
          remoteId={viewedPdf.remoteId}
          onViewed={() => void markResourceViewed(viewedPdf.id)}
          onClose={() => {
            setViewedPdf(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
