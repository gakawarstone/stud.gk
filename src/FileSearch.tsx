import { Search, X } from "lucide-solid";
import { onCleanup, onMount, Show } from "solid-js";

export function FileSearch(props: {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  total: number;
  inFolder: boolean;
}) {
  let input!: HTMLInputElement;
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ F" : "Ctrl F";

  onMount(() => {
    function find(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.key.toLowerCase() !== "f" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        document.querySelector('dialog[open], [aria-modal="true"]')
      )
        return;
      event.preventDefault();
      input.focus();
      input.select();
    }
    document.addEventListener("keydown", find);
    onCleanup(() => document.removeEventListener("keydown", find));
  });

  function clear() {
    props.onQuery("");
    input.focus();
  }

  return (
    <div class="file-search" role="search" aria-label="Course files">
      <Search size={15} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label={props.inFolder ? "Search files in this folder" : "Search course files"}
        aria-keyshortcuts="Control+f Meta+f"
        aria-describedby="file-search-results"
        placeholder={props.inFolder ? "Search this folder…" : "Search files…"}
        value={props.query}
        onInput={(event) => props.onQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && props.query) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
      />
      <span id="file-search-results" class="file-search-count" role="status" aria-live="polite" aria-atomic="true">
        <span aria-hidden="true">{props.query.trim() ? `${props.count} / ${props.total}` : props.total}</span>
        <span class="visually-hidden">{props.count} of {props.total} files</span>
      </span>
      <Show when={props.query} fallback={<kbd aria-hidden="true">{shortcut}</kbd>}>
        <button type="button" aria-label="Clear search" title="Clear search" onClick={clear}>
          <X size={14} aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
