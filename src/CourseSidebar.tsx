import { CalendarDays, Cloud, FolderClosed, GitFork, Info, Megaphone, Plus, Trash2, X } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup } from "solid-js";
import { extraCourseTabs, isExtraCourseTab, type CourseTab, type ExtraCourseTab } from "./course-tabs";
export const courseTabs = {
  files: { label: "Files", Icon: FolderClosed },
  news: { label: "Announcements", Icon: Megaphone },
  schedule: { label: "Schedule", Icon: CalendarDays },
  course: { label: "Course info", Icon: Info },
  nextcloud: { label: "Nextcloud", Icon: Cloud },
  gitlab: { label: "GitLab", Icon: GitFork },
};
export function CourseSidebar(props: {
  storageKey: string;
  activeTab: CourseTab;
  unreadNews: boolean;
  onSelect: (tab: CourseTab) => void;
}) {
  const [tabs, setTabs] = createSignal<ExtraCourseTab[]>(
    (() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(props.storageKey) || "[]");
        return Array.isArray(saved) ? [...new Set(saved.filter(isExtraCourseTab))] : [];
      } catch {
        return [];
      }
    })(),
  );
  const [openMenu, setOpenMenu] = createSignal<"add" | ExtraCourseTab | null>(null);
  let sidebar: HTMLElement | null = null;
  let addButton: HTMLButtonElement | null = null;
  let menu: HTMLDivElement | null = null;
  let pendingFocus: (CourseTab | null) | null = null;
  const visibleTabs = createMemo<CourseTab[]>(() => {
    const visible: CourseTab[] = ["files", ...tabs()];
    if (props.activeTab !== "files" && !visible.includes(props.activeTab)) visible.push(props.activeTab);
    return visible;
  });
  const availableTabs = createMemo(() => extraCourseTabs.filter((tab) => !visibleTabs().includes(tab)));
  createEffect(
    on(
      () => [props.storageKey, tabs()],
      () => {
        try {
          localStorage.setItem(props.storageKey, JSON.stringify(tabs()));
        } catch {
          /* Navigation also works without persistent storage. */
        }
      },
    ),
  );
  createEffect(
    on(
      () => [tabs()],
      () => {
        const tab = pendingFocus;
        pendingFocus = null;
        if (tab) sidebar?.querySelector<HTMLButtonElement>(`[data-course-tab="${tab}"]`)?.focus();
      },
    ),
  );
  createEffect(
    on(
      () => [props.activeTab],
      () => {
        setOpenMenu(null);
      },
    ),
  );
  createEffect(
    on(
      () => [openMenu()],
      () => {
        if (!openMenu()) return;
        menu?.querySelector<HTMLButtonElement>("button")?.focus();
        function outside(event: PointerEvent) {
          if (!sidebar?.contains(event.target as Node)) setOpenMenu(null);
        }
        function escape(event: KeyboardEvent) {
          if (event.key !== "Escape") return;
          event.preventDefault();
          const previous = openMenu();
          setOpenMenu(null);
          if (previous === "add") addButton?.focus();
          else sidebar?.querySelector<HTMLButtonElement>(`[data-course-tab="${previous}"]`)?.focus();
        }
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        onCleanup(() => {
          document.removeEventListener("pointerdown", outside);
          document.removeEventListener("keydown", escape);
        });
      },
    ),
  );
  function select(tab: CourseTab) {
    pendingFocus = tab;
    setOpenMenu(null);
    props.onSelect(tab);
  }
  function add(tab: ExtraCourseTab) {
    batch(() => {
      setTabs((current) => (current.includes(tab) ? current : [...current, tab]));
      select(tab);
    });
  }
  function remove(tab: ExtraCourseTab) {
    batch(() => {
      setTabs((current) => current.filter((value) => value !== tab));
      const next = props.activeTab === tab ? "files" : props.activeTab;
      select(next);
    });
  }
  function renderMenu(kind: "add" | ExtraCourseTab) {
    return (
      <div
        ref={(element) => (menu = element)}
        class="course-add-menu"
        role="menu"
        aria-label={kind === "add" ? "Add tab" : courseTabs[kind].label}
        onKeyDown={(event) => {
          const items = [...menu!.querySelectorAll<HTMLButtonElement>("button")];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "ArrowDown"
              ? (current + 1) % items.length
              : event.key === "ArrowUp"
                ? (current - 1 + items.length) % items.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : null;
          if (next !== null) {
            event.preventDefault();
            items[next].focus();
          }
        }}
      >
        {kind === "add" ? (
          <For each={availableTabs()}>
            {(tab) => {
              const { label, Icon } = courseTabs[tab];
              return (
                <button type="button" role="menuitem" aria-label={`Add ${label}`} onClick={() => add(tab)}>
                  <Icon size={17} stroke-width={1.6} aria-hidden="true" />
                  <span>{label}</span>
                  <Plus size={15} class="course-add-mark" aria-hidden="true" />
                </button>
              );
            }}
          </For>
        ) : (
          <button
            type="button"
            role="menuitem"
            aria-label={`Remove ${courseTabs[kind].label} from sidebar`}
            onClick={() => remove(kind)}
          >
            <Trash2 size={17} stroke-width={1.6} aria-hidden="true" />
            <span>Remove from sidebar</span>
          </button>
        )}
      </div>
    );
  }
  return (
    <nav ref={(element) => (sidebar = element)} class="course-sidebar" aria-label="Course tabs">
      <For each={visibleTabs()}>
        {(tab) => {
          const { label, Icon } = courseTabs[tab];
          return (
            <div class="course-add-wrap">
              <button
                type="button"
                class="course-rail-button"
                data-course-tab={tab}
                aria-label={label}
                aria-current={props.activeTab === tab ? "page" : undefined}
                onClick={() => {
                  setOpenMenu(null);
                  props.onSelect(tab);
                }}
                onContextMenu={
                  tab === "files"
                    ? undefined
                    : (event) => {
                        event.preventDefault();
                        setOpenMenu(tab);
                      }
                }
                onKeyDown={
                  tab === "files"
                    ? undefined
                    : (event) => {
                        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                          event.preventDefault();
                          setOpenMenu(tab);
                        }
                      }
                }
              >
                <Icon size={19} stroke-width={1.6} aria-hidden="true" />
                {tab === "news" && props.unreadNews && <span class="course-rail-dot" />}
                <span class="course-rail-tooltip" aria-hidden="true">
                  {label}
                </span>
              </button>
              {tab !== "files" && openMenu() === tab && renderMenu(tab)}
            </div>
          );
        }}
      </For>
      <div class="course-add-wrap">
        <button
          ref={(element) => (addButton = element)}
          type="button"
          class="course-rail-button"
          aria-label={openMenu() === "add" ? "Close tab menu" : "Add tab"}
          disabled={!availableTabs().length}
          aria-expanded={openMenu() === "add"}
          aria-haspopup="menu"
          onClick={() => setOpenMenu(openMenu() === "add" ? null : "add")}
        >
          {openMenu() === "add" ? <X size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
          {openMenu() !== "add" && (
            <span class="course-rail-tooltip" aria-hidden="true">
              {availableTabs().length ? "Add tab" : "All tabs added"}
            </span>
          )}
        </button>
        {openMenu() === "add" && renderMenu("add")}
      </div>
    </nav>
  );
}
