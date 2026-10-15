import test from "node:test";
import assert from "node:assert/strict";
import { listFolder } from "./course-folders.ts";

const tree = {
  rootId: "root",
  folders: [
    { id: "root", title: "Files", parentId: null, readable: true },
    { id: "lectures", title: "Vorlesungen", parentId: "root", readable: true },
    { id: "tasks", title: "Übungen", parentId: "root", readable: true },
    { id: "project", title: "Projekt", parentId: "tasks", readable: true },
    { id: "locked", title: "Abgaben", parentId: "root", readable: false },
  ],
  fileFolders: [
    { fileRefId: "lecture", folderId: "lectures" },
    { fileRefId: "task", folderId: "tasks" },
    { fileRefId: "project", folderId: "project" },
    { fileRefId: "root-file", folderId: "root" },
    { fileRefId: "orphan", folderId: "removed" },
  ],
};
const files = ["lecture", "task", "project", "root-file", "orphan", "new-file"]
  .map((remoteId) => ({ remoteId }));

test("folder view hides the root container and counts nested files without flattening them", () => {
  const root = listFolder(tree, null, files);
  assert.equal(root.currentId, "root");
  assert.deepEqual(root.path, []);
  assert.deepEqual(new Set(root.folders.map((folder) => folder.id)), new Set(["lectures", "tasks", "locked"]));
  assert.equal(root.folders.find((folder) => folder.id === "tasks").files.length, 2);
  assert.equal(root.folders.find((folder) => folder.id === "locked").readable, false);
  const tasks = listFolder(tree, "tasks", files);
  assert.deepEqual(tasks.folders.map((folder) => folder.id), ["project"]);
  assert.deepEqual(tasks.files.map((file) => file.remoteId), ["task"]);
  const project = listFolder(tree, "project", files);
  assert.deepEqual(project.path.map((folder) => folder.id), ["tasks", "project"]);
  assert.deepEqual(project.files.map((file) => file.remoteId), ["project"]);
});

test("stale or missing mappings never hide files from the folder root", () => {
  const root = listFolder(tree, "deleted-folder", files);
  assert.deepEqual(root.files.map((file) => file.remoteId), ["root-file", "orphan", "new-file"]);
  assert.equal(root.currentId, "root");
  assert.deepEqual(listFolder({ rootId: null, folders: [], fileFolders: [] }, null, files).files, files);
});

test("empty folders and malformed parent cycles do not loop or invent files", () => {
  assert.deepEqual(listFolder(tree, "locked", files).files, []);
  const cycle = { ...tree, folders: [
    ...tree.folders,
    { id: "a", title: "A", parentId: "b", readable: true },
    { id: "b", title: "B", parentId: "a", readable: true },
  ] };
  assert.equal(listFolder(cycle, "a", files).path.length, 2);
});
