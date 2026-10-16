import { useEffect, useRef, useState } from "react";
import { CalendarDays, Cloud, FolderClosed, GitFork, Info, Megaphone, Plus, Trash2, X } from "lucide-react";
import { extraCourseTabs, isExtraCourseTab, type CourseTab, type ExtraCourseTab } from "./course-tabs";

export const courseTabs = {
  files: { label: "Dateien", Icon: FolderClosed },
  news: { label: "Ankündigungen", Icon: Megaphone },
  schedule: { label: "Termine", Icon: CalendarDays },
  course: { label: "Kursinfo", Icon: Info },
  nextcloud: { label: "Nextcloud", Icon: Cloud },
  gitlab: { label: "GitLab", Icon: GitFork },
};

export function CourseSidebar({
  storageKey, activeTab, unreadNews, onSelect,
}: {
  storageKey: string;
  activeTab: CourseTab;
  unreadNews: boolean;
  onSelect: (tab: CourseTab) => void;
}) {
  const [tabs, setTabs] = useState<ExtraCourseTab[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved) ? [...new Set(saved.filter(isExtraCourseTab))] : [];
    } catch {
      return [];
    }
  });
  const [openMenu, setOpenMenu] = useState<"add" | ExtraCourseTab | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visibleTabs: CourseTab[] = ["files", ...tabs];
  if (activeTab !== "files" && !tabs.includes(activeTab)) visibleTabs.push(activeTab);
  const availableTabs = extraCourseTabs.filter((tab) => !visibleTabs.includes(tab));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(tabs));
    } catch { /* Navigation also works without persistent storage. */ }
  }, [storageKey, tabs]);

  useEffect(() => { setOpenMenu(null); }, [activeTab]);
  useEffect(() => {
    if (!openMenu) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function outside(event: PointerEvent) {
      if (!sidebar.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenMenu(null);
      if (openMenu === "add") addButton.current?.focus();
      else sidebar.current?.querySelector<HTMLButtonElement>(`[data-course-tab="${openMenu}"]`)?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenu]);

  function select(tab: CourseTab) {
    setOpenMenu(null);
    onSelect(tab);
    requestAnimationFrame(() => sidebar.current?.querySelector<HTMLButtonElement>(`[data-course-tab="${tab}"]`)?.focus());
  }

  function add(tab: ExtraCourseTab) {
    setTabs((current) => current.includes(tab) ? current : [...current, tab]);
    select(tab);
  }

  function remove(tab: ExtraCourseTab) {
    setTabs((current) => current.filter((value) => value !== tab));
    const next = activeTab === tab ? "files" : activeTab;
    select(next);
  }

  function renderMenu(kind: "add" | ExtraCourseTab) {
    return <div ref={menu} className="course-add-menu" role="menu"
      aria-label={kind === "add" ? "Добавить вкладку" : courseTabs[kind].label}
      onKeyDown={(event) => {
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (current + 1) % items.length
          : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next !== null) { event.preventDefault(); items[next].focus(); }
      }}>
      {kind === "add" ? availableTabs.map((tab) => {
        const { label, Icon } = courseTabs[tab];
        return <button key={tab} type="button" role="menuitem"
          aria-label={`Добавить ${label}`} onClick={() => add(tab)}>
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span>
          <Plus size={15} className="course-add-mark" aria-hidden="true" />
        </button>;
      }) : <button type="button" role="menuitem"
        aria-label={`Удалить ${courseTabs[kind].label} из панели`} onClick={() => remove(kind)}>
        <Trash2 size={17} strokeWidth={1.6} aria-hidden="true" /><span>Удалить из панели</span>
      </button>}
    </div>;
  }

  return (
    <nav ref={sidebar} className="course-sidebar" aria-label="Вкладки курса">
      {visibleTabs.map((tab) => {
        const { label, Icon } = courseTabs[tab];
        return <div key={tab} className="course-add-wrap"><button type="button" className="course-rail-button"
          data-course-tab={tab} aria-label={label}
          aria-current={activeTab === tab ? "page" : undefined}
          onClick={() => { setOpenMenu(null); onSelect(tab); }}
          onContextMenu={tab === "files" ? undefined : (event) => {
            event.preventDefault();
            setOpenMenu(tab);
          }}
          onKeyDown={tab === "files" ? undefined : (event) => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              setOpenMenu(tab);
            }
          }}>
          <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
          {tab === "news" && unreadNews && <span className="course-rail-dot" />}
          <span className="course-rail-tooltip" aria-hidden="true">{label}</span>
        </button>{tab !== "files" && openMenu === tab && renderMenu(tab)}</div>;
      })}
      <div className="course-add-wrap">
        <button ref={addButton} type="button" className="course-rail-button"
          aria-label={openMenu === "add" ? "Закрыть меню вкладок" : "Добавить вкладку"}
          disabled={!availableTabs.length}
          aria-expanded={openMenu === "add"} aria-haspopup="menu"
          onClick={() => setOpenMenu(openMenu === "add" ? null : "add")}>
          {openMenu === "add" ? <X size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
          {openMenu !== "add" && <span className="course-rail-tooltip" aria-hidden="true">{availableTabs.length ? "Добавить вкладку" : "Все вкладки добавлены"}</span>}
        </button>
        {openMenu === "add" && renderMenu("add")}
      </div>
    </nav>
  );
}
