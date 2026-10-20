import type { RequestHandler } from "express";
import type { CookieJar, SerializedCookieJar } from "tough-cookie";
import type { AccountState, Snapshot, CourseResource, CourseFolders } from "../shared/studip.js";
import type { createClient } from "./studip.js";
import type { createGitlabClient } from "./gitlab-client.js";
import type { createNextcloudClient } from "./nextcloud.js";

export type User = { id: string; name: string };
export type Auth = { user: User; jar: SerializedCookieJar; expiresAt: number };
export type Context = {
  sessionId: string;
  user: User;
  jar: CookieJar;
  client: ReturnType<typeof createClient>;
  expiresAt: number;
  revoked: boolean;
};
export type SavedState = { accounts: Record<string, AccountState>; demo: AccountState };
export type ReadOptions = { signal?: AbortSignal; range?: string };
export type GitlabOptions = { signal?: AbortSignal; token?: string; ref?: string };
export type PublicRequestOptions = {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  signal?: AbortSignal;
};
export type AppOptions = {
  dataDir: string;
  authenticate?: (username: unknown, password: unknown) => Promise<{ user: User; jar: CookieJar }>;
  getSnapshot?: (client: Context["client"], user: User) => Promise<Snapshot>;
  getFolders?: (client: Context["client"], courseId: string) => Promise<CourseFolders>;
  getDownload?: (client: Context["client"], file: CourseResource, options: ReadOptions) => Promise<Response>;
  getGitlabReadme?: ReturnType<typeof createGitlabClient>["readme"];
  getGitlabTree?: ReturnType<typeof createGitlabClient>["list"];
  getGitlabBranches?: ReturnType<typeof createGitlabClient>["branches"];
  getGitlabFile?: ReturnType<typeof createGitlabClient>["file"];
  getGitlabContent?: ReturnType<typeof createGitlabClient>["content"];
  nextcloudClient?: ReturnType<typeof createNextcloudClient>;
  autoSync?: boolean;
  sessionName?: string;
};
export type RouteState = { state: SavedState; save: () => Promise<void>; requireLogin: RequestHandler };

declare global {
  namespace Express {
    interface Request { context: Context | null }
  }
}
declare module "express-session" {
  interface SessionData {
    auth?: Auth;
    gitlabTokens?: Record<string, string>;
  }
}
