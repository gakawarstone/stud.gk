import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, LockKeyhole } from "lucide-react";
import type { CourseFolders } from "./course-folders";

export function FolderExplorer({ data, currentId, courseId }: {
  data: CourseFolders;
  currentId: string | null;
  courseId: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]));
  useEffect(() => {
    const ancestors = new Set<string>();
    let id = currentId;
    while (id && !ancestors.has(id)) {
      ancestors.add(id);
      id = data.folders.find((folder) => folder.id === id)?.parentId ?? null;
    }
    setExpanded((previous) => new Set([...previous, ...ancestors]));
  }, [currentId, data]);

  function renderLevel(parentId: string | null, ancestors = new Set<string>()): ReactNode {
    const children = data.folders.filter((folder) => folder.id !== data.rootId &&
      (byId.has(folder.parentId || "") ? folder.parentId : data.rootId) === parentId &&
      !ancestors.has(folder.id))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    if (!children.length) return null;
    const hasBranchGutter = children.some((folder) => folder.readable &&
      data.folders.some((child) => child.parentId === folder.id && child.id !== folder.id));
    return <ul>
      {children.map((folder) => {
        const hasChildren = folder.readable && data.folders.some((child) =>
          child.parentId === folder.id && !ancestors.has(child.id) && child.id !== folder.id);
        const isExpanded = expanded.has(folder.id);
        const selected = currentId === folder.id;
        const Icon = selected ? FolderOpen : Folder;
        return <li key={folder.id}>
          <div className="explorer-folder-row">
            {hasChildren ? <button type="button" className="explorer-branch-toggle"
              aria-label={`${isExpanded ? "Свернуть" : "Развернуть"} папку ${folder.title}`}
              aria-expanded={isExpanded}
              onClick={() => setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(folder.id)) next.delete(folder.id);
                else next.add(folder.id);
                return next;
              })}>
              <ChevronRight size={13} aria-hidden="true" />
            </button> : hasBranchGutter ? <span className="explorer-branch-spacer" /> : null}
            <button type="button" className="explorer-folder-link"
              disabled={!folder.readable}
              aria-label={folder.readable ? `Открыть папку ${folder.title}` : `${folder.title}. Нет доступа`}
              aria-current={selected ? "page" : undefined}
              title={folder.title}
              onClick={() => {
                window.location.hash = new URLSearchParams({ course: courseId, folder: folder.id }).toString();
              }}>
              <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
              <span>{folder.title}</span>
              {!folder.readable && <LockKeyhole size={12} aria-hidden="true" />}
            </button>
          </div>
          {hasChildren && isExpanded && renderLevel(folder.id, new Set([...ancestors, folder.id]))}
        </li>;
      })}
    </ul>;
  }

  return <nav className="folder-explorer-sidebar" aria-label="Папки курса">
    {renderLevel(data.rootId) || <p className="explorer-no-folders">Вложенных папок нет</p>}
  </nav>;
}
