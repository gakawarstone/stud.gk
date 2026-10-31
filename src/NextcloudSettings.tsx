import { ExternalLink, Link, RefreshCw, Settings } from "lucide-solid";
import { createEffect, createSignal, createUniqueId, on, onCleanup } from "solid-js";
export function NextcloudSettings(props: { url: string; loading: boolean; onRefresh: () => void; onEdit: () => void }) {
  const [open, setOpen] = createSignal(false);
  let container: HTMLDivElement | null = null;
  let button: HTMLButtonElement | null = null;
  let menu: HTMLDivElement | null = null;
  const menuId = createUniqueId();
  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) button?.focus();
  }
  createEffect(
    on(
      () => [open()],
      () => {
        if (!open()) return;
        menu?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
        function outside(event: PointerEvent) {
          if (!container?.contains(event.target as Node)) setOpen(false);
        }
        function escape(event: KeyboardEvent) {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setOpen(false);
          button?.focus();
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
  return (
    <div
      class="nextcloud-tools"
      ref={(element) => (container = element)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={(element) => (button = element)}
        type="button"
        aria-label="Nextcloud settings"
        title="Nextcloud settings"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? menuId : undefined}
        onClick={() => setOpen(!open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Settings size={17} aria-hidden="true" />
      </button>
      {open() && (
        <div
          ref={(element) => (menu = element)}
          id={menuId}
          class="nextcloud-settings-menu"
          role="menu"
          aria-label="Nextcloud settings"
          onKeyDown={(event) => {
            const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
            const current = items.indexOf(document.activeElement as HTMLElement);
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
              items[next]?.focus();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-label="Refresh Nextcloud files"
            disabled={props.loading}
            onClick={() => {
              close();
              props.onRefresh();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh files</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label="Edit Nextcloud link"
            onClick={() => {
              close(false);
              props.onEdit();
            }}
          >
            <Link size={16} aria-hidden="true" />
            <span>Edit link</span>
          </button>
          <a
            role="menuitem"
            href={props.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open Nextcloud in browser"
            onClick={() => close()}
          >
            <ExternalLink size={16} aria-hidden="true" />
            <span>Open in browser</span>
          </a>
        </div>
      )}
    </div>
  );
}
