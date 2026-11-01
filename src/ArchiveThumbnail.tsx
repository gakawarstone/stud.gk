import { FileArchive, Folder, LoaderCircle } from "lucide-solid";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { archiveTree } from "./archive-tree";
import { RepositoryFileIcon } from "./RepositoryFileIcon";
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
      <span class="archive-preview-format" aria-label="ZIP archive"><FileArchive size={13} aria-hidden="true" />ZIP</span>
      <Show when={!contents.error} fallback={<span class="thumbnail-fallback"><FileArchive size={28} /><span>{contents.error?.message || "Preview unavailable"}</span></span>}>
        <Show when={contents()} fallback={<LoaderCircle class="thumbnail-loading spin" size={20} aria-label="Loading archive contents" />}>
          {(listing) => {
            const tree = createMemo(() => archiveTree(listing()));
            return <>
              <div class="archive-preview-entries">
                <For each={tree().rows}>{(entry) => (
                  <div class="archive-preview-entry" classList={{ "archive-preview-folder": entry.directory }} title={entry.path}
                    style={{ "padding-left": `${Math.min(entry.depth, 3) * 10}px` }}>
                    <span class="archive-preview-entry-icon">
                      {entry.directory ? <Folder size={15} /> : <RepositoryFileIcon name={entry.name} />}
                    </span>
                    <span class="archive-preview-name">{entry.name}</span>
                  </div>
                )}</For>
                <Show when={!listing().entries.length}><span class="archive-preview-empty">Empty archive</span></Show>
              </div>
            </>;
          }}
        </Show>
      </Show>
    </div>
  );
}
