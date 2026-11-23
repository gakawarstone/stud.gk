import type { ArchiveContents } from "../shared/archive";

type Node = { name: string; path: string; directory: boolean; children: Map<string, Node> };
export function archiveTree(contents: ArchiveContents) {
  const root: Node = { name: "", path: "", directory: true, children: new Map() };
  for (const entry of contents.entries) {
    const parts = entry.name.split("/").filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const directory = index < parts.length - 1 || entry.directory;
      let node = parent.children.get(name);
      if (!node) {
        node = { name, path: parts.slice(0, index + 1).join("/"), directory, children: new Map() };
        parent.children.set(name, node);
      }
      parent = node;
    });
  }
  // An enclosing directory belongs in the header, once.
  const first = [...root.children.values()];
  const enclosing = first.length === 1 && first[0].directory ? first[0] : root;
  const rows: { name: string; path: string; directory: boolean; depth: number }[] = [];
  function visit(parent: Node, depth: number) {
    for (let node of parent.children.values()) {
      if (rows.length === 5) return;
      let name = node.name;
      // Compact chains such as src/main/kotlin into a single folder row.
      while (node.directory && node.children.size === 1) {
        const child = [...node.children.values()][0];
        if (!child.directory) break;
        name += `/${child.name}`;
        node = child;
      }
      rows.push({ name, path: node.path, directory: node.directory, depth });
      visit(node, depth + 1);
    }
  }
  visit(enclosing, 0);
  return { folder: enclosing.name, rows: rows.slice(0, 5) };
}
