import { Check, ChevronDown, GitBranch, Search } from "lucide-solid";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup } from "solid-js";
import type { GitlabBranch } from "./gitlab-api";
export function GitlabBranchPicker(props: {
  branches: GitlabBranch[];
  value: string;
  loading: boolean;
  onChange: (branch: string) => void;
}) {
  const [open, setOpen] = createSignal(false),
    [query, setQuery] = createSignal("");
  let root: HTMLDivElement | null = null,
    trigger: HTMLButtonElement | null = null,
    search: HTMLInputElement | null = null;
  const id = createUniqueId();
  const matches = createMemo(() =>
    props.branches.filter((branch) => branch.name.toLocaleLowerCase().includes(query().toLocaleLowerCase())),
  );
  function close() {
    setOpen(false);
    trigger?.focus();
  }
  createEffect(
    on(
      () => [open()],
      () => {
        if (!open()) return;
        search?.focus();
        const outside = (event: PointerEvent) => {
          if (!root?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", outside);
        onCleanup(() => document.removeEventListener("pointerdown", outside));
      },
    ),
  );
  function navigate(
    event: KeyboardEvent & {
      currentTarget: HTMLDivElement;
    },
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const options = [...(root?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index >= 0 && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      options[index].click();
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = index < 0 ? options.length - 1 : index - 1;
    else if (index >= 0 && event.key === "Home") next = 0;
    else if (index >= 0 && event.key === "End") next = options.length - 1;
    if (next !== null) {
      event.preventDefault();
      if (next < 0) search?.focus();
      else options[next]?.focus();
    }
  }
  return (
    <div
      class="gitlab-branch-picker"
      ref={(element) => (root = element)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={(element) => (trigger = element)}
        class="gitlab-branch-trigger"
        type="button"
        aria-label={`Ветка GitLab: ${props.value || "нет веток"}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={open() ? id : undefined}
        disabled={props.loading || !props.branches.length}
        onClick={() => {
          setQuery("");
          setOpen(!open());
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setQuery("");
            setOpen(true);
          }
        }}
      >
        <GitBranch size={15} aria-hidden="true" />
        <span>{props.value || (props.loading ? "Загрузка…" : "Нет веток")}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open() && (
        <div id={id} class="gitlab-branch-popover" role="dialog" aria-label="Сменить ветку" onKeyDown={navigate}>
          <label class="gitlab-branch-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={(element) => (search = element)}
              value={query()}
              onInput={(event) => setQuery(event.target.value)}
              aria-label="Найти ветку"
              placeholder="Найти ветку…"
              autocomplete="off"
            />
          </label>
          <div class="gitlab-branch-options" role="listbox" aria-label="Ветки GitLab">
            <For each={matches()}>
              {(branch) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={branch.name === props.value}
                  title={branch.name}
                  onClick={() => {
                    close();
                    if (branch.name !== props.value) props.onChange(branch.name);
                  }}
                >
                  <GitBranch size={14} aria-hidden="true" />
                  <span>{branch.name}</span>
                  {branch.name === props.value && <Check size={15} aria-hidden="true" />}
                </button>
              )}
            </For>
            {!matches().length && <p role="status">Ветки не найдены</p>}
          </div>
        </div>
      )}
    </div>
  );
}
