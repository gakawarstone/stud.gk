import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, KeyRound, Link, RefreshCw, Settings, Unlink } from "lucide-react";

export function GitlabSettings({ url, onRefresh, onEdit, onAccess, onUnlink }: {
  url: string; onRefresh: () => void; onEdit: () => void; onAccess?: () => void; onUnlink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  function action(callback: () => void) { setOpen(false); button.current?.focus(); callback(); }
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="gitlab-tools" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={button} type="button" aria-label="GitLab settings" title="GitLab settings" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
      onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>
      <Settings size={17} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={id} className="gitlab-settings-menu" role="menu" aria-label="GitLab settings" onKeyDown={(event) => {
      const items = [...menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length
        : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    }}>
      <button role="menuitem" type="button" onClick={() => action(onRefresh)}><RefreshCw size={16} /><span>Refresh files</span></button>
      {onAccess && <button role="menuitem" type="button" onClick={() => action(onAccess)}><KeyRound size={16} /><span>GitLab access</span></button>}
      <button role="menuitem" type="button" onClick={() => action(onEdit)}><Link size={16} /><span>Edit link</span></button>
      <a role="menuitem" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}><ExternalLink size={16} /><span>Open in browser</span></a>
      <button role="menuitem" type="button" onClick={() => action(onUnlink)}><Unlink size={16} /><span>Unlink project</span></button>
    </div>}
  </div>;
}
