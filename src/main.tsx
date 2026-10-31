import "./styles.css";
import {
  ArrowLeft,
  BellDot,
  ChevronRight,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderTree,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  TriangleAlert,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Dynamic, render } from "solid-js/web";
import type { Change, Material } from "../shared/studip";
import { CourseSections } from "./CourseSections";
import { CourseSidebar } from "./CourseSidebar";
import { FileThumbnail } from "./FileThumbnail";
import { FolderExplorer } from "./FolderExplorer";
import { GitlabProject } from "./GitlabProject";
import { Login } from "./Login";
import { NextcloudSection } from "./NextcloudSection";
import { PdfFileIcon } from "./PdfFileIcon";
import { PdfViewer } from "./PdfViewer";
import { readPdfWindowState } from "./pdf-window";
import { api, ApiError } from "./api";
import { listFolder, type CourseFolders } from "./course-folders";
import { courseIcon } from "./course-icons";
import { courseTabFromHash, courseTabLink } from "./course-tabs";
import { createCourseOrder } from "./create-course-order";
import { createFeedSession } from "./create-feed-session";
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
  return [file.updatedAt, file.createdAt].find((date) => date && Number.isFinite(Date.parse(date))) || "";
}
function fileAppearance(title: string) {
  const extension = title.includes(".") ? title.split(".").pop()!.toLowerCase() : "";
  if (extension === "pdf") return { Icon: PdfFileIcon, label: "PDF", tone: "pdf" };
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].includes(extension))
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
  if (["js", "ts", "py", "java", "c", "cpp", "html", "css", "json"].includes(extension))
    return { Icon: FileCode, label: extension.toUpperCase(), tone: "code" };
  return {
    Icon: FileText,
    label: extension && extension.length <= 8 ? extension.toUpperCase() : "File",
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
  return `${count} ${count === 1 ? "file" : "files"}`;
}
function App() {
  const {
    phase,
    data,
    busy,
    error,
    generation,
    load,
    signedOut,
    login,
    showDemo,
    logout,
    refresh: refreshFeed,
    markResourceViewed,
    saveGitlabProject: saveProject,
  } = createFeedSession(resetSessionUi);
  const [fileError, setFileError] = createSignal<string | null>(null);
  const [viewedPdf, setViewedPdf] = createSignal<Material | null>(null);
  const [nextcloudToolbar, setNextcloudToolbar] = createSignal<HTMLDivElement | null>(null);
  const [gitlabToolbar, setGitlabToolbar] = createSignal<HTMLDivElement | null>(null);
  const [selectedCourseId, setSelectedCourseId] = createSignal(courseFromHash());
  const [selectedTab, setSelectedTab] = createSignal(courseTabFromHash());
  const [selectedFolderId, setSelectedFolderId] = createSignal(folderFromHash());
  const [fileView, setFileView] = createSignal<"all" | "folders">(
    (() => {
      if (folderFromHash()) return "folders";
      try {
        return localStorage.getItem("stud-gk-file-view") === "folders" ? "folders" : "all";
      } catch {
        return "all";
      }
    })(),
  );
  const [folderRevision, setFolderRevision] = createSignal(0);
  let initialFolderCourse: (string | null) | null = null;
  const [folderState, setFolderState] = createSignal<{
    courseId: string;
    data: CourseFolders | null;
    error: string | null;
  } | null>(null);
  const { orderedCourses, courseDrag, moveCourse, startCourseDrag, suppressCardClickUntil, cancelCourseDrag } =
    createCourseOrder(() => data()?.courses ?? []);
  const selectedCourse = createMemo(() => orderedCourses().find((c) => c.id === selectedCourseId()));
  const courseSettingsScope = createMemo(() =>
    JSON.stringify([phase(), data()?.user?.id || "", selectedCourse()?.id || ""]),
  );
  const fileChanges = createMemo(() =>
    (data()?.changes ?? []).filter((c) => c.kind === "file" && c.action !== "removed"),
  );
  const currentFileIds = createMemo(
    () => new Set((data()?.resources ?? []).filter((r) => r.kind === "file").map((r) => r.id)),
  );
  const unreadFiles = createMemo(() => {
    const result = new Map<string, Change>();
    for (const change of [...fileChanges()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))) {
      if (
        !change.read &&
        change.resourceId &&
        currentFileIds().has(change.resourceId) &&
        !result.has(change.resourceId)
      )
        result.set(change.resourceId, change);
    }
    return result;
  });
  onMount(() => {
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
    onCleanup(() => window.removeEventListener("hashchange", navigate));
  });
  createEffect(
    on(
      () => [fileView()],
      () => {
        try {
          localStorage.setItem("stud-gk-file-view", fileView());
        } catch {
          /* The current view still works when storage is unavailable. */
        }
      },
    ),
  );
  createEffect(
    on(
      () => [selectedCourse()?.id, selectedTab(), fileView(), phase(), data()?.lastSync, folderRevision()],
      () => {
        const courseId = selectedCourse()?.id;
        if (
          !courseId ||
          selectedTab() !== "files" ||
          fileView() !== "folders" ||
          (phase() !== "live" && phase() !== "demo")
        )
          return;
        let cancelled = false;
        const controller = new AbortController();
        const version = generation.current;
        setFolderState({ courseId, data: null, error: null });
        const route = phase() === "demo" ? "/api/demo/courses" : "/api/courses";
        void api<CourseFolders>(`${route}/${encodeURIComponent(courseId)}/folders`, undefined, controller.signal)
          .then((folders) => {
            if (!cancelled && version === generation.current) {
              setFolderState({ courseId, data: folders, error: null });
              if (initialFolderCourse !== courseId) {
                initialFolderCourse = courseId;
                const root = listFolder(
                  folders,
                  null,
                  (data()?.resources ?? []).filter((file) => file.kind === "file" && file.courseId === courseId),
                );
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
              signedOut("Your session has expired. Sign in to Stud.IP again.");
              return;
            }
            setFolderState({
              courseId,
              data: null,
              error: error instanceof ApiError ? error.message : "Could not load folders. Try again.",
            });
          });
        onCleanup(() => {
          cancelled = true;
          controller.abort();
        });
      },
    ),
  );
  function resetSessionUi() {
    setViewedPdf(null);
    cancelCourseDrag();
    setFolderState(null);
    initialFolderCourse = null;
    setFileError(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setSelectedCourseId(null);
    setSelectedTab("files");
    setSelectedFolderId(null);
  }
  createEffect(
    on(
      () => [unreadFiles().size, selectedCourse()?.title],
      () => {
        const unread = unreadFiles().size;
        document.title = `${unread ? `(${unread}) ` : ""}Stud.GK · ${selectedCourse()?.title || "Courses"}`;
      },
    ),
  );
  async function refresh() {
    setFileError(null);
    await refreshFeed();
  }
  async function saveGitlabProject(url: string | null, projectId?: string) {
    if (selectedCourse()) return saveProject(selectedCourse()!.id, url, projectId);
  }
  const allFiles = createMemo(() => (data()?.resources ?? []).filter((r) => r.kind === "file"));
  const courseFiles = createMemo(() =>
    allFiles()
      .filter((f) => f.courseId === selectedCourse()?.id)
      .sort(
        (a, b) =>
          (materialDate(b) ? Date.parse(materialDate(b)) : -Infinity) -
            (materialDate(a) ? Date.parse(materialDate(a)) : -Infinity) ||
          a.title.localeCompare(b.title, undefined, { numeric: true }) ||
          a.id.localeCompare(b.id),
      ),
  );
  const folderData = createMemo(() => (folderState()?.courseId === selectedCourse()?.id ? folderState()?.data : null));
  const folderError = createMemo(() =>
    folderState()?.courseId === selectedCourse()?.id ? folderState()?.error : null,
  );
  const folderListing = createMemo(() =>
    folderData() ? listFolder(folderData()!, selectedFolderId(), courseFiles()) : null,
  );
  const folders = createMemo(() => (fileView() === "folders" ? (folderListing()?.folders ?? []) : []));
  const files = createMemo(() => (fileView() === "folders" ? (folderListing()?.files ?? []) : courseFiles()));
  const linkedProjects = createMemo(() => {
    const course = selectedCourse(),
      projects = data()?.gitlabProjects;
    // Read the key even when absent so a later server binding is reactive.
    const project = course ? projects?.[course.id] : undefined;
    return course && projects && Object.hasOwn(projects, course.id) ? (project ?? []) : [];
  });
  function changeFileView(view: "all" | "folders") {
    if (view === "folders" && fileView() !== "folders") initialFolderCourse = null;
    setFileView(view);
    setFileError(null);
    setViewedPdf(null);
    if (view === "all" && selectedCourse() && folderFromHash()) {
      window.history.replaceState(null, "", folderLink(selectedCourse()!.id));
      setSelectedFolderId(null);
    }
  }
  const syncError = createMemo(() => error() || data()?.error);
  const partial = createMemo(() =>
    Boolean(
      selectedCourse() &&
        data()?.unavailableSources?.some((s) => s.courseId === selectedCourse()!.id && s.kind === "file"),
    ),
  );
  const syncing = createMemo(() => busy() || data()?.syncing);
  return (
    <div class={`page${selectedCourse() ? " page--course" : ""}`}>
      <header class={`header${selectedCourse() ? " header--course" : ""}`}>
        <div class="brand" role="img" aria-label="Stud.GK">
          <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
            <g fill="none" stroke-width="8" stroke-linecap="butt" stroke-linejoin="round">
              <path
                d="M48 14H25.657Q24 14 22.828 15.172L16.828 21.172Q14 24 17.655 25.625L24.858 28.826"
                stroke="currentColor"
              />
              <path d="M27.142 29.841L36.858 34.159" stroke="var(--peach)" />
              <path
                d="M39.142 35.174L46.345 38.375Q50 40 47.172 42.828L41.172 48.828Q40 50 38.343 50H16"
                stroke="var(--sky)"
              />
            </g>
            <circle cx="48" cy="14" r="5" />
            <circle cx="16" cy="50" r="5" fill="var(--sky)" />
          </svg>
          <span aria-hidden="true">tud.GK</span>
        </div>
        {selectedCourse() && (
          <div class="course-toolbar">
            <nav class="course-path" aria-label="Course navigation">
              <a class="back-to-courses" href="#">
                <ArrowLeft size={16} /> All courses
              </a>
              <ChevronRight class="path-separator" size={16} />
              <h1 class="course-heading" title={selectedCourse()!.title}>
                {selectedTab() === "files" && fileView() === "folders" ? (
                  <a href={folderLink(selectedCourse()!.id)}>{selectedCourse()!.title}</a>
                ) : (
                  selectedCourse()!.title
                )}
              </h1>
            </nav>
            {selectedTab() === "files" && (
              <div class="file-view-switch" role="group" aria-label="File view">
                <button
                  type="button"
                  aria-pressed={fileView() === "all"}
                  aria-label="All files"
                  title="All files"
                  onClick={() => changeFileView("all")}
                >
                  <LayoutGrid size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={fileView() === "folders"}
                  aria-label="Folders"
                  title="Folders"
                  onClick={() => changeFileView("folders")}
                >
                  <FolderTree size={15} aria-hidden="true" />
                </button>
              </div>
            )}
            {selectedTab() === "nextcloud" && <div class="nextcloud-toolbar" ref={setNextcloudToolbar} />}
            {selectedTab() === "gitlab" && <div class="gitlab-toolbar" ref={setGitlabToolbar} />}
          </div>
        )}
        {(phase() === "live" || phase() === "demo") && (
          <div class="account">
            {phase() === "demo" ? (
              <>
                <span class="demo-badge">Demo</span>
                <button class="text-button" onClick={() => signedOut()}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                <button
                  class="account-button"
                  onClick={() => void logout()}
                  disabled={busy()}
                  aria-label={`Sign out of ${data()?.user?.name || ""}`}
                  title={`Sign out of ${data()?.user?.name || ""}`}
                >
                  <span class="account-name">{userInitials(data()?.user?.name)}</span>
                  <LogOut size={16} stroke-width={1.5} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </header>
      {phase() === "loading" ? (
        <div class="loading">
          <LoaderCircle size={24} class="spin" />
          Loading…
        </div>
      ) : phase() === "login" ? (
        <Login error={error()} busy={busy()} onLogin={login} onDemo={() => void showDemo()} />
      ) : (
        <main class={`feed-main${selectedCourse() ? " feed-main--course" : ""}`}>
          {!selectedCourse() && <h1 class="visually-hidden">Courses</h1>}
          {(syncError() || fileError()) && (
            <div class="feed-error" role="alert">
              {syncError() || fileError()}
            </div>
          )}
          {selectedCourse() && selectedTab() === "files" && partial() && !syncError() && !fileError() && (
            <div class="feed-warning" role="status">
              <TriangleAlert size={13} />
              Some files are unavailable in Stud.IP.
            </div>
          )}
          {!selectedCourse() && (
            <p id="course-sort-help" class="visually-hidden">
              Drag a card by its handle to reorder it. With a keyboard, focus the handle and use the arrow keys.
            </p>
          )}
          {courseDrag() && (
            <div
              class="course-drag-preview"
              aria-hidden="true"
              style={{
                left: `${Math.max(8, Math.min(courseDrag()!.x + 14, window.innerWidth - 248))}px`,
                top: `${Math.max(8, Math.min(courseDrag()!.y + 14, window.innerHeight - 90))}px`,
              }}
            >
              <GripVertical size={16} />
              {data()?.courses.find((c) => c.id === courseDrag()!.id)?.title}
            </div>
          )}
          <div class={selectedCourse() ? "course-workspace" : undefined}>
            {selectedCourse() && (
              <Show when={courseSettingsScope()} keyed>
                {(_key) => (
                  <CourseSidebar
                    storageKey={`stud-gk-course-tabs:${courseSettingsScope()}`}
                    activeTab={selectedTab()}
                    unreadNews={(data()?.changes ?? []).some(
                      (change) =>
                        change.courseId === selectedCourse()!.id &&
                        change.kind === "news" &&
                        !change.read &&
                        change.action !== "removed" &&
                        data()?.resources.some((item) => item.id === change.resourceId),
                    )}
                    onSelect={(tab) => {
                      window.location.hash = courseTabLink(selectedCourse()!.id, tab, selectedFolderId());
                    }}
                  />
                )}
              </Show>
            )}
            <div class={selectedCourse() ? "course-content" : undefined}>
              {selectedCourse() && selectedTab() !== "files" ? (
                selectedTab() === "gitlab" ? (
                  <Show when={`${phase()}:${selectedCourse()!.id}`} keyed>
                    {(_key) => (
                      <GitlabProject
                        courseId={selectedCourse()!.id}
                        projects={linkedProjects()}
                        demo={phase() === "demo"}
                        onSave={saveGitlabProject}
                        toolbarTarget={gitlabToolbar()}
                      />
                    )}
                  </Show>
                ) : selectedTab() === "nextcloud" ? (
                  <Show when={courseSettingsScope()} keyed>
                    {(_key) => (
                      <NextcloudSection
                        storageKey={`stud-gk-nextcloud:${courseSettingsScope()}`}
                        toolbarTarget={nextcloudToolbar()}
                      />
                    )}
                  </Show>
                ) : (
                  <Show when={`${selectedCourse()!.id}:${selectedTab()}`} keyed>
                    {(_key) => (
                      <CourseSections
                        course={selectedCourse()!}
                        tab={selectedTab() as "news" | "schedule" | "course"}
                        resources={data()?.resources ?? []}
                        unavailable={Boolean(
                          data()?.unavailableSources?.some(
                            (source) => source.courseId === selectedCourse()!.id && source.kind === selectedTab(),
                          ),
                        )}
                        onRead={(id) => void markResourceViewed(id)}
                      />
                    )}
                  </Show>
                )
              ) : (
                <div
                  class={selectedCourse() && fileView() === "folders" && folderData() ? "course-explorer" : undefined}
                >
                  {selectedCourse() && fileView() === "folders" && folderData() && (
                    <Show when={selectedCourse()!.id} keyed>
                      {(_key) => (
                        <FolderExplorer
                          data={folderData()!}
                          currentId={folderListing()?.currentId ?? null}
                          courseId={selectedCourse()!.id}
                        />
                      )}
                    </Show>
                  )}
                  <section
                    class={
                      selectedCourse() ? (fileView() === "folders" ? "explorer-files" : "file-grid") : "course-grid"
                    }
                    aria-label={
                      selectedCourse()
                        ? fileView() === "folders"
                          ? "Course folders and files"
                          : "Course files"
                        : "Courses"
                    }
                  >
                    {selectedCourse() && fileView() === "folders" && !folderListing() && (
                      <div class="empty" role="status">
                        {folderError() ? <TriangleAlert size={28} /> : <LoaderCircle class="spin" size={28} />}
                        <h2>{folderError() ? "Could not load folders" : "Loading folders…"}</h2>
                        {folderError() && (
                          <>
                            <p>{folderError()}</p>
                            <button class="empty-link" onClick={() => setFolderRevision((value) => value + 1)}>
                              Retry
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {!selectedCourse() && (
                      <For each={orderedCourses()}>
                        {(course) => {
                          const CourseIcon = createMemo(() => courseIcon(course.title));
                          const count = createMemo(() => allFiles().filter((f) => f.courseId === course.id).length);
                          const newCount = createMemo(
                            () => allFiles().filter((f) => f.courseId === course.id && unreadFiles().has(f.id)).length,
                          );
                          const unavailable = createMemo(() =>
                            data()?.unavailableSources?.some((s) => s.courseId === course.id && s.kind === "file"),
                          );
                          return (
                            <article
                              class={`course-card ${course.color || "mauve"} ${courseDrag()?.id === course.id ? "dragging" : ""} ${courseDrag()?.targetId === course.id && courseDrag()!.id !== course.id ? "drop-target" : ""}`}
                              data-course-id={course.id}
                              onPointerDown={(event) => startCourseDrag(event, course.id)}
                              onDragStart={(event) => event.preventDefault()}
                              on:click={{
                                capture: true,
                                handleEvent: (event: MouseEvent) => {
                                  if (Date.now() < suppressCardClickUntil()) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }
                                },
                              }}
                            >
                              <a
                                class="course-card-link"
                                href={`#${new URLSearchParams({ course: course.id })}`}
                                draggable={false}
                              >
                                <div class="course-card-top">
                                  <span class="course-card-icon" aria-hidden="true">
                                    <Dynamic component={CourseIcon()} size={24} stroke-width={1.6} />
                                  </span>
                                  <h2 title={course.title}>{course.title}</h2>
                                </div>
                                <div class="course-card-footer">
                                  <div class="course-card-meta">
                                    <span
                                      class="course-file-count"
                                      role="img"
                                      aria-label={fileCountLabel(count())}
                                      title={fileCountLabel(count())}
                                    >
                                      <FileText size={14} aria-hidden="true" /> {count()}
                                    </span>
                                    {newCount() > 0 && (
                                      <span
                                        class="course-new-count"
                                        role="img"
                                        aria-label={`Updates: ${newCount()}`}
                                        title={`Updates: ${newCount()}`}
                                      >
                                        <BellDot size={14} aria-hidden="true" /> {newCount()}
                                      </span>
                                    )}
                                    {unavailable() && (
                                      <span
                                        class="course-card-warning"
                                        role="img"
                                        aria-label="Some files are unavailable"
                                        title="Some files are unavailable"
                                      >
                                        <TriangleAlert size={14} aria-hidden="true" />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </a>
                              <button
                                class="course-drag-handle"
                                aria-label={`Reorder: ${course.title}`}
                                aria-describedby="course-sort-help"
                                title="Drag course"
                                onKeyDown={(event) => {
                                  const direction =
                                    event.key === "ArrowUp" || event.key === "ArrowLeft"
                                      ? -1
                                      : event.key === "ArrowDown" || event.key === "ArrowRight"
                                        ? 1
                                        : 0;
                                  if (!direction) return;
                                  event.preventDefault();
                                  const target =
                                    orderedCourses()[orderedCourses().findIndex((c) => c.id === course.id) + direction];
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
                        }}
                      </For>
                    )}
                    {selectedCourse() && (
                      <For each={files()}>
                        {(file) => {
                          const appearance = createMemo(() => fileAppearance(file.title));
                          const date = createMemo(() => materialDate(file));
                          const unread = createMemo(() => unreadFiles().get(file.id));
                          const previewLabel = createMemo(
                            () =>
                              `Open ${file.title}${unread() ? (unread()!.action === "added" ? ". New file" : ". Updated file") : ""}`,
                          );
                          const body = createMemo(() => (
                            <>
                              {fileView() === "folders" ? (
                                <span class="explorer-file-icon">
                                  <Dynamic
                                    component={appearance().Icon}
                                    size={appearance().tone === "pdf" ? 20 : 18}
                                    stroke-width={1.6}
                                    aria-hidden="true"
                                  />
                                </span>
                              ) : phase() === "live" &&
                                file.remoteId &&
                                (appearance().tone === "pdf" || appearance().tone === "image") ? (
                                <FileThumbnail
                                  url={`/api/files/${encodeURIComponent(file.remoteId)}/content`}
                                  version={`${generation.current}:${file.updatedAt || file.createdAt || ""}`}
                                  kind={appearance().tone as "pdf" | "image"}
                                />
                              ) : (
                                <div class={`file-preview ${appearance().tone}`}>
                                  <Dynamic component={appearance().Icon} size={44} stroke-width={1.4} />
                                  <span class="file-type">{appearance().label}</span>
                                </div>
                              )}
                              <div class="file-info">
                                <h2 title={file.title}>{file.title}</h2>
                                <div class="file-meta">
                                  {date() && (
                                    <time datetime={date()}>
                                      {new Date(date()).toLocaleDateString("en-GB", {
                                        day: "numeric",
                                        month: "short",
                                        year: "numeric",
                                      })}
                                    </time>
                                  )}
                                </div>
                              </div>
                            </>
                          ));
                          return (
                            <article class={`file-card ${unread() ? "unread" : ""}`}>
                              {phase() === "live" && file.remoteId && appearance().tone === "pdf" ? (
                                <button
                                  class="file-card-link"
                                  aria-label={previewLabel()}
                                  aria-haspopup="dialog"
                                  onClick={() => {
                                    setFileError(null);
                                    setViewedPdf(file);
                                  }}
                                >
                                  {body()}
                                </button>
                              ) : phase() === "live" && file.remoteId ? (
                                <a
                                  class="file-card-link"
                                  aria-label={previewLabel()}
                                  href={`/api/files/${encodeURIComponent(file.remoteId)}/preview`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setFileError(null)}
                                >
                                  {body()}
                                </a>
                              ) : (
                                <button
                                  class="file-card-link"
                                  aria-label={previewLabel()}
                                  onClick={() =>
                                    setFileError(
                                      phase() === "demo"
                                        ? "File preview is unavailable in demo mode."
                                        : "This file has no preview link.",
                                    )
                                  }
                                >
                                  {body()}
                                </button>
                              )}
                            </article>
                          );
                        }}
                      </For>
                    )}
                    {(selectedCourse()
                      ? !files().length && (fileView() === "all" || Boolean(folderListing()))
                      : !orderedCourses().length) && (
                      <div class="empty">
                        <span>
                          {data()?.syncing ? (
                            <LoaderCircle class="spin" size={28} />
                          ) : syncError() || !data()?.lastSync ? (
                            <TriangleAlert size={28} />
                          ) : (
                            <FileText size={28} />
                          )}
                        </span>
                        <h2>
                          {data()?.syncing
                            ? "Loading your courses"
                            : syncError() || !data()?.lastSync
                              ? "Could not check courses"
                              : selectedCourse()
                                ? fileView() === "folders"
                                  ? folders().length
                                    ? "Select a subfolder"
                                    : "This folder is empty"
                                  : "No files yet"
                                : "No courses yet"}
                        </h2>
                        <p>
                          {data()?.syncing ? (
                            "This may take a moment."
                          ) : syncError() || !data()?.lastSync ? (
                            <button class="empty-link" onClick={() => void refresh()} disabled={syncing()}>
                              Check again
                            </button>
                          ) : selectedCourse() ? (
                            fileView() === "folders" ? (
                              folders().length ? (
                                "Subfolders are listed on the left."
                              ) : (
                                "No files are available in this folder yet."
                              )
                            ) : (
                              "No files in the available sections."
                            )
                          ) : (
                            "Your courses will appear here after checking Stud.IP."
                          )}
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </main>
      )}
      <Show when={phase() === "live" && viewedPdf()?.remoteId ? viewedPdf() : null} keyed>
        {(file) => (
          <PdfViewer
            title={file.title}
            remoteId={file.remoteId!}
            onViewed={() => void markResourceViewed(file.id)}
            onClose={() => {
              setViewedPdf(null);
              void load();
            }}
          />
        )}
      </Show>
    </div>
  );
}
const detachedPdf = readPdfWindowState(location.hash, location.origin);
if (detachedPdf) document.title = `${detachedPdf.title} | Stud.GK`;
render(
  () => detachedPdf ? (
    <PdfViewer
      title={detachedPdf.title}
      contentUrl={detachedPdf.contentUrl}
      downloadUrl={detachedPdf.downloadUrl}
      initialView={detachedPdf}
      detached
      onClose={() => window.close()}
    />
  ) : <App />,
  document.getElementById("root")!,
);
