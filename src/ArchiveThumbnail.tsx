import { FileArchive, FileText, Folder, LoaderCircle } from "lucide-solid";
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api } from "./api";
import type { ArchiveContents } from "../shared/archive";

export function ArchiveThumbnail(props: { id: string; version: string }) {
  let container!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);
  const [contents] = createResource(
    () => visible() ? { id: props.id, version: props.version } : null,
    (key) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      return api<ArchiveContents>(`/api/files/${encodeURIComponent(key.id)}/contents`, undefined, controller.signal);
    },
  );
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "120px" });
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="file-preview archive archive-preview" ref={container}>
      <div class="archive-preview-heading"><FileArchive size={16} /><span>ZIP CONTENTS</span></div>
      <Show when={!contents.error} fallback={<span class="thumbnail-fallback"><FileArchive size={28} /><span>{contents.error?.message || "Preview unavailable"}</span></span>}>
        <Show when={contents()} fallback={<LoaderCircle class="thumbnail-loading spin" size={20} aria-label="Loading archive contents" />}>
          {(listing) => <>
            <div class="archive-preview-entries">
              <For each={listing().entries.slice(0, 5)}>{(entry) => (
                <div class="archive-preview-entry" title={entry.name}>
                  {entry.directory ? <Folder size={14} /> : <FileText size={14} />}
                  <span>{entry.name}</span>
                </div>
              )}</For>
              <Show when={!listing().entries.length}><span class="archive-preview-empty">Empty archive</span></Show>
            </div>
            <span class="archive-preview-count">{listing().total} entries{listing().total > 5 ? ` · +${listing().total - 5} more` : ""}</span>
          </>}
        </Show>
      </Show>
    </div>
  );
}
