import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink, Link, RefreshCw, Settings } from "lucide-react";

export function NextcloudSettings({ url, loading, onRefresh, onEdit }: {
  url: string;
  loading: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    function outside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="nextcloud-tools" ref={container}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={button} type="button" aria-label="Настройки Nextcloud" title="Настройки Nextcloud"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}><Settings size={17} aria-hidden="true" /></button>
    {open && <div ref={menu} id={menuId} className="nextcloud-settings-menu" role="menu" aria-label="Настройки Nextcloud"
      onKeyDown={(event) => {
        const items = [...menu.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "ArrowDown" ? (current + 1) % items.length
          : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (next !== null) { event.preventDefault(); items[next]?.focus(); }
      }}>
      <button type="button" role="menuitem" aria-label="Обновить файлы Nextcloud" disabled={loading}
        onClick={() => { close(); onRefresh(); }}><RefreshCw size={16} aria-hidden="true" /><span>Обновить файлы</span></button>
      <button type="button" role="menuitem" aria-label="Изменить ссылку Nextcloud"
        onClick={() => { close(false); onEdit(); }}><Link size={16} aria-hidden="true" /><span>Изменить ссылку</span></button>
      <a role="menuitem" href={url} target="_blank" rel="noreferrer" aria-label="Открыть Nextcloud в браузере"
        onClick={() => close()}><ExternalLink size={16} aria-hidden="true" /><span>Открыть в браузере</span></a>
    </div>}
  </div>;
}
