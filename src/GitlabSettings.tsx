import {
  ExternalLink,
  KeyRound,
  Link,
  RefreshCw,
  Settings,
  Unlink,
} from "lucide-solid";
import {
  createEffect,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from "solid-js";
export function GitlabSettings(props: {
  url: string;
  onRefresh: () => void;
  onEdit: () => void;
  onAccess?: () => void;
  onUnlink: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | null = null,
    button: HTMLButtonElement | null = null,
    menu: HTMLDivElement | null = null;
  const id = createUniqueId();
  function action(callback: () => void) {
    setOpen(false);
    button?.focus();
    callback();
  }
  createEffect(
    on(
      () => [open()],
      () => {
        if (!open()) return;
        menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        function outside(event: PointerEvent) {
          if (!root?.contains(event.target as Node)) setOpen(false);
        }
        function escape(event: KeyboardEvent) {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            button?.focus();
          }
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
      ref={(element) => (root = element)}
      class="gitlab-tools"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={(element) => (button = element)}
        type="button"
        aria-label="Настройки GitLab"
        title="Настройки GitLab"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? id : undefined}
        onClick={() => setOpen(!open())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
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
          id={id}
          class="gitlab-settings-menu"
          role="menu"
          aria-label="Настройки GitLab"
          onKeyDown={(event) => {
            const items = [
              ...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]'),
            ];
            const current = items.indexOf(
              document.activeElement as HTMLElement,
            );
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
            role="menuitem"
            type="button"
            onClick={() => action(props.onRefresh)}
          >
            <RefreshCw size={16} />
            <span>Обновить файлы</span>
          </button>
          {props.onAccess && (
            <button
              role="menuitem"
              type="button"
              onClick={() => action(props.onAccess!)}
            >
              <KeyRound size={16} />
              <span>Доступ GitLab</span>
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => action(props.onEdit)}
          >
            <Link size={16} />
            <span>Изменить ссылку</span>
          </button>
          <a
            role="menuitem"
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <ExternalLink size={16} />
            <span>Открыть в браузере</span>
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => action(props.onUnlink)}
          >
            <Unlink size={16} />
            <span>Отвязать проект</span>
          </button>
        </div>
      )}
    </div>
  );
}
