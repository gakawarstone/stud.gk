import { Settings } from "lucide-solid";
import { createEffect, createSignal, createUniqueId, on, onCleanup, type JSX } from "solid-js";
export function CourseSettingsMenu(props: {
  label: string;
  children: (close: (restoreFocus?: boolean) => void) => JSX.Element;
}) {
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
        aria-label={props.label}
        title={props.label}
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
          aria-label={props.label}
          onKeyDown={(event) => {
            const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
            if (!items.length) return;
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
          {props.children(close)}
        </div>
      )}
    </div>
  );
}
