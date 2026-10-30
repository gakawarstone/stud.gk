import { ChevronRight, Folder, FolderOpen, LockKeyhole } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { CourseFolders } from "./course-folders";
export function FolderExplorer(props: { data: CourseFolders; currentId: string | null; courseId: string }) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const byId = createMemo(() => new Map(props.data.folders.map((folder) => [folder.id, folder])));
  createEffect(
    on(
      () => [props.currentId, props.data],
      () => {
        const ancestors = new Set<string>();
        let id = props.currentId;
        while (id && !ancestors.has(id)) {
          ancestors.add(id);
          id = props.data.folders.find((folder) => folder.id === id)?.parentId ?? null;
        }
        setExpanded((previous) => new Set([...previous, ...ancestors]));
      },
    ),
  );
  function renderLevel(parentId: string | null, ancestors = new Set<string>()): JSX.Element {
    const children = createMemo(() =>
      props.data.folders
        .filter(
          (folder) =>
            folder.id !== props.data.rootId &&
            (byId().has(folder.parentId || "") ? folder.parentId : props.data.rootId) === parentId &&
            !ancestors.has(folder.id),
        )
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    );
    if (!children().length) return null;
    const hasBranchGutter = createMemo(() =>
      children().some(
        (folder) =>
          folder.readable && props.data.folders.some((child) => child.parentId === folder.id && child.id !== folder.id),
      ),
    );
    return (
      <ul>
        <For each={children()}>
          {(folder) => {
            const hasChildren = createMemo(
              () =>
                folder.readable &&
                props.data.folders.some(
                  (child) => child.parentId === folder.id && !ancestors.has(child.id) && child.id !== folder.id,
                ),
            );
            const isExpanded = createMemo(() => expanded().has(folder.id));
            const selected = createMemo(() => props.currentId === folder.id);
            const Icon = createMemo(() => (selected() ? FolderOpen : Folder));
            return (
              <li>
                <div class="explorer-folder-row">
                  {hasChildren() ? (
                    <button
                      type="button"
                      class="explorer-branch-toggle"
                      aria-label={`${isExpanded() ? "Свернуть" : "Развернуть"} папку ${folder.title}`}
                      aria-expanded={isExpanded()}
                      onClick={() =>
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (next.has(folder.id)) next.delete(folder.id);
                          else next.add(folder.id);
                          return next;
                        })
                      }
                    >
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  ) : hasBranchGutter() ? (
                    <span class="explorer-branch-spacer" />
                  ) : null}
                  <button
                    type="button"
                    class="explorer-folder-link"
                    disabled={!folder.readable}
                    aria-label={folder.readable ? `Открыть папку ${folder.title}` : `${folder.title}. Нет доступа`}
                    aria-current={selected() ? "page" : undefined}
                    title={folder.title}
                    onClick={() => {
                      window.location.hash = new URLSearchParams({
                        course: props.courseId,
                        folder: folder.id,
                      }).toString();
                    }}
                  >
                    <Dynamic component={Icon()} size={16} stroke-width={1.6} aria-hidden="true" />
                    <span>{folder.title}</span>
                    {!folder.readable && <LockKeyhole size={12} aria-hidden="true" />}
                  </button>
                </div>
                {hasChildren() && isExpanded() && renderLevel(folder.id, new Set([...ancestors, folder.id]))}
              </li>
            );
          }}
        </For>
      </ul>
    );
  }
  return (
    <nav class="folder-explorer-sidebar" aria-label="Папки курса">
      {renderLevel(props.data.rootId) || <p class="explorer-no-folders">Вложенных папок нет</p>}
    </nav>
  );
}
