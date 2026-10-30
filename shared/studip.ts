import type { GitlabProject } from "../server/gitlab.js";

export type CourseDetails = {
  id: string;
  title: string;
  code?: string;
  semester?: string;
  description?: string;
  location?: string;
  url: string | null;
};
export type Course = CourseDetails & { color: string };
export type ResourceKind = "file" | "news" | "schedule" | "course";
export type CourseResource = {
  id: string;
  remoteId?: string;
  kind: ResourceKind;
  courseId: string;
  title: string;
  description: string;
  location?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  start?: string | number | null;
  end?: string | number | null;
  cancelled?: boolean;
  size?: number;
  mime?: string;
  fileId?: string | null;
};
export type Material = CourseResource;
export type Change = CourseResource & {
  resourceId?: string;
  occurredAt: string;
  action: "added" | "updated" | "removed";
  read: boolean;
  starred?: boolean;
  before?: CourseResource;
};
export type Snapshot = {
  courses: Course[];
  resources: CourseResource[];
  semester?: string;
  unavailableSources?: { courseId: string; kind: ResourceKind }[];
};
export type AccountState = Snapshot & {
  changes: Change[];
  lastSync: string | null;
  gitlabProjects?: Record<string, GitlabProject[]>;
};
export type Feed = AccountState & {
  authenticated: boolean;
  mode: "live" | "demo";
  syncing: boolean;
  error: string | null;
  user: { id: string; name: string } | null;
  source?: string;
};
export type AuthState = Feed | { authenticated: false; authExpired: boolean };
export type CourseFolder = { id: string; title: string; parentId: string | null; readable: boolean };
export type CourseFolders = {
  rootId: string | null;
  folders: CourseFolder[];
  fileFolders: { fileRefId: string; folderId: string | null }[];
};
