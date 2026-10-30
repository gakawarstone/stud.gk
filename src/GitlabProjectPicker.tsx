import { createSignal, createEffect, on, onCleanup, createUniqueId, For } from "solid-js";
import { Check, ChevronDown, GitFork, Plus } from "lucide-solid";
import type { GitlabProject } from "../server/gitlab.js";
export function GitlabProjectPicker(props: {
  projects: GitlabProject[];
  selected: GitlabProject | null;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const root: {
      current: HTMLDivElement | null;
    } = {
      current: null,
    },
    button: {
      current: HTMLButtonElement | null;
    } = {
      current: null,
    },
    menu: {
      current: HTMLDivElement | null;
    } = {
      current: null,
    };
  const id = createUniqueId();
  function action(callback: () => void) {
    setOpen(false);
    button.current?.focus();
    callback();
  }
  createEffect(
    on(
      () => [open()],
      () => {
        if (!open()) return;
        const active =
          menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
          menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
        active?.focus();
        function outside(event: PointerEvent) {
          if (!root.current?.contains(event.target as Node)) setOpen(false);
        }
        function escape(event: KeyboardEvent) {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            button.current?.focus();
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
      ref={(element) => (root.current = element)}
      class="gitlab-project-picker"
      data-project-count={props.projects.length}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={(element) => (button.current = element)}
        type="button"
        class="gitlab-project-trigger"
        aria-label="Select GitLab project"
        title={props.selected?.url || "https://gitlab.com"}
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
        <GitFork size={15} aria-hidden="true" />
        <span>
          {props.adding
            ? "Add project"
            : new URL(props.selected?.url || "https://gitlab.com").pathname.split("/").pop()}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open() && (
        <div
          ref={(element) => (menu.current = element)}
          id={id}
          class="gitlab-project-menu"
          role="menu"
          aria-label="GitLab projects"
          onKeyDown={(event) => {
            const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            if (current >= 0 && ["Enter", " "].includes(event.key)) {
              event.preventDefault();
              items[current].click();
              return;
            }
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
          {
            <For each={props.projects}>
              {(project) => {
                const address = new URL(project.url);
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={!props.adding && props.selected?.id === project.id}
                    title={project.url}
                    onClick={() => action(() => props.onSelect(project.id))}
                  >
                    <GitFork size={15} aria-hidden="true" />
                    <span>
                      <strong>{address.pathname.slice(1)}</strong>
                      <small>{address.host}</small>
                    </span>
                    {!props.adding && props.selected?.id === project.id && <Check size={15} aria-hidden="true" />}
                  </button>
                );
              }}
            </For>
          }
          <button class="gitlab-add-project" type="button" role="menuitem" onClick={() => action(props.onAdd)}>
            <Plus size={16} aria-hidden="true" />
            Add project
          </button>
        </div>
      )}
    </div>
  );
}
