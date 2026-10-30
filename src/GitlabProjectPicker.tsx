import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, GitFork, Plus } from "lucide-react";
import type { GitlabProject } from "../server/gitlab.js";

export function GitlabProjectPicker({ projects, selected, adding, onSelect, onAdd }: {
  projects: GitlabProject[]; selected: GitlabProject; adding: boolean;
  onSelect: (id: string) => void; onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  function action(callback: () => void) { setOpen(false); button.current?.focus(); callback(); }
  useEffect(() => {
    if (!open) return;
    const active = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    active?.focus();
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="gitlab-project-picker" data-project-count={projects.length} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={button} type="button" className="gitlab-project-trigger" aria-label="Select GitLab project" title={selected.url}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
      onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <GitFork size={15} aria-hidden="true" /><span>{adding ? "Add project" : new URL(selected.url).pathname.split("/").pop()}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={id} className="gitlab-project-menu" role="menu" aria-label="GitLab projects" onKeyDown={(event) => {
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (current >= 0 && ["Enter", " "].includes(event.key)) { event.preventDefault(); items[current].click(); return; }
      const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length
        : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}>
      {projects.map((project) => {
        const address = new URL(project.url);
        return <button key={project.id} type="button" role="menuitemradio" aria-checked={!adding && selected.id === project.id}
          title={project.url} onClick={() => action(() => onSelect(project.id))}>
          <GitFork size={15} aria-hidden="true" /><span><strong>{address.pathname.slice(1)}</strong><small>{address.host}</small></span>
          {!adding && selected.id === project.id && <Check size={15} aria-hidden="true" />}
        </button>;
      })}
      <button className="gitlab-add-project" type="button" role="menuitem" onClick={() => action(onAdd)}>
        <Plus size={16} aria-hidden="true" />Add project
      </button>
    </div>}
  </div>;
}
