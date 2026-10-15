export type CourseFolder = {
  id: string;
  title: string;
  parentId: string | null;
  readable: boolean;
};
export type CourseFolders = {
  rootId: string | null;
  folders: CourseFolder[];
  fileFolders: { fileRefId: string; folderId: string | null }[];
};

export function listFolder<T extends { remoteId?: string }>(
  data: CourseFolders,
  selectedId: string | null,
  files: T[],
) {
  const byId = new Map(data.folders.map((folder) => [folder.id, folder]));
  const currentId = selectedId && byId.has(selectedId) ? selectedId : data.rootId;
  const parentOf = (id: string | null) =>
    id && byId.has(id) ? id : data.rootId;
  const fileParents = new Map(data.fileFolders.map((file) => [file.fileRefId, file.folderId]));
  const folderFor = (file: T) => parentOf(fileParents.get(file.remoteId || "") ?? null);
  const path: CourseFolder[] = [];
  const visited = new Set<string>();
  let ancestor = currentId;
  while (ancestor && ancestor !== data.rootId && !visited.has(ancestor)) {
    visited.add(ancestor);
    const folder = byId.get(ancestor);
    if (!folder) break;
    path.unshift(folder);
    ancestor = folder.parentId;
  }
  const descendants = (id: string) => {
    const ids = new Set([id]);
    const queue = [id];
    for (let i = 0; i < queue.length; i++)
      for (const folder of data.folders)
        if (folder.parentId === queue[i] && !ids.has(folder.id)) {
          ids.add(folder.id);
          queue.push(folder.id);
        }
    return ids;
  };
  return {
    currentId,
    path,
    files: files.filter((file) => folderFor(file) === currentId),
    folders: data.folders
      .filter((folder) => folder.id !== data.rootId && folder.id !== currentId &&
        parentOf(folder.parentId) === currentId)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
      .map((folder) => {
        const ids = descendants(folder.id);
        return { ...folder, files: files.filter((file) => ids.has(folderFor(file) || "")) };
      }),
  };
}
