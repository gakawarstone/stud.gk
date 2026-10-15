import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, FolderClosed, Info, Megaphone, Plus, X } from "lucide-react";
import { extraCourseTabs, isExtraCourseTab, type CourseTab, type ExtraCourseTab } from "./course-tabs";

export const courseTabs = {
  files: { label: "Dateien", Icon: FolderClosed },
  news: { label: "Ankündigungen", Icon: Megaphone },
  schedule: { label: "Termine", Icon: CalendarDays },
  course: { label: "Kursinfo", Icon: Info },
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
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visibleTabs: CourseTab[] = ["files", ...tabs];
  if (activeTab !== "files" && !tabs.includes(activeTab)) visibleTabs.push(activeTab);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(tabs));
    } catch { /* Navigation also works without persistent storage. */ }
  }, [storageKey, tabs]);

  useEffect(() => { setOpen(false); }, [activeTab]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function outside(event: PointerEvent) {
      if (!sidebar.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      addButton.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle(tab: ExtraCourseTab) {
    const removing = visibleTabs.includes(tab);
    setTabs(removing
      ? tabs.filter((value) => value !== tab)
      : [...tabs, tab]);
    setOpen(false);
    const next = removing ? activeTab === tab ? "files" : activeTab : tab;
    onSelect(next);
    requestAnimationFrame(() => sidebar.current?.querySelector<HTMLButtonElement>(`[data-course-tab="${next}"]`)?.focus());
  }

  return (
    <nav ref={sidebar} className="course-sidebar" aria-label="Вкладки курса">
      {visibleTabs.map((tab) => {
        const { label, Icon } = courseTabs[tab];
        return <button key={tab} type="button" className="course-rail-button"
          data-course-tab={tab} aria-label={label}
          aria-current={activeTab === tab ? "page" : undefined}
          onClick={() => { setOpen(false); onSelect(tab); }}>
          <Icon size={19} strokeWidth={1.6} aria-hidden="true" />
          {tab === "news" && unreadNews && <span className="course-rail-dot" />}
          <span className="course-rail-tooltip" aria-hidden="true">{label}</span>
        </button>;
      })}
      <div className="course-add-wrap">
        <button ref={addButton} type="button" className="course-rail-button"
          aria-label={open ? "Закрыть меню вкладок" : "Добавить вкладку"}
          aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
          {open ? <X size={20} aria-hidden="true" /> : <Plus size={20} aria-hidden="true" />}
          {!open && <span className="course-rail-tooltip" aria-hidden="true">Добавить вкладку</span>}
        </button>
        {open && <div ref={menu} className="course-add-menu" role="menu" aria-label="Вкладки курса"
          onKeyDown={(event) => {
            const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? (current + 1) % items.length
              : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length
              : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
            if (next !== null) { event.preventDefault(); items[next].focus(); }
          }}>
          {extraCourseTabs.map((tab) => {
            const { label, Icon } = courseTabs[tab];
            const added = visibleTabs.includes(tab);
            return <button key={tab} type="button" role="menuitemcheckbox" aria-checked={added}
              aria-label={`${added ? "Убрать" : "Добавить"} ${label}`} onClick={() => toggle(tab)}>
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span>
              {added ? <Check size={15} className="course-add-mark" aria-hidden="true" /> : <Plus size={15} className="course-add-mark" aria-hidden="true" />}
            </button>;
          })}
        </div>}
      </div>
    </nav>
  );
}
