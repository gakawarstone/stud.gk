import { api, ApiError } from "./api.ts";
import type { AuthState, Feed } from "../shared/studip.ts";
import type { GitlabProject } from "../server/gitlab.js";

export const SESSION_EXPIRED = "Сессия истекла. Войди в Stud.IP заново.";
type SessionState = {
  phase: "loading" | "login" | "live" | "demo";
  data: Feed | null;
  busy: boolean;
  error: string | null;
};
type Options = {
  request?: typeof api;
  onSignedOut?: () => void;
  onSessionChange?: () => void;
  onFeed?: (feed: Feed, previousSync: string | null) => void;
};

// Own request lifetimes independently of React renders. Session changes invalidate
// every operation; within a session only the most recent state request may commit.
export class FeedSession {
  generation = { current: 0 };
  private state: SessionState = { phase: "loading", data: null, busy: false, error: null };
  private listeners = new Set<() => void>();
  private request: typeof api;
  private options: Options;
  private mode: "live" | "demo" = "live";
  private currentLoad: AbortController | null = null;
  private previousSync: string | null = null;
  private authPending = false;

  constructor(options: Options = {}) {
    this.options = options;
    this.request = options.request ?? api;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private cancelLoad() {
    this.currentLoad?.abort();
    this.currentLoad = null;
  }
  private newGeneration() {
    this.cancelLoad();
    this.generation.current++;
    this.previousSync = null;
    this.options.onSessionChange?.();
    return this.generation.current;
  }
  dispose = () => {
    this.cancelLoad();
    this.generation.current++;
  };
  signedOut = (message: string | null = null) => {
    this.newGeneration();
    this.authPending = false;
    this.mode = "live";
    this.update({ phase: "login", data: null, busy: false, error: message });
    this.options.onSignedOut?.();
  };
  load = async () => {
    if (this.authPending) return;
    this.cancelLoad();
    const controller = new AbortController();
    this.currentLoad = controller;
    const version = this.generation.current;
    const current = () => this.currentLoad === controller && version === this.generation.current;
    try {
      const next = await this.request<AuthState>(
        this.mode === "demo" ? "/api/demo" : "/api/state", undefined, controller.signal,
      );
      if (!current()) return;
      if (!("mode" in next)) {
        if (this.state.phase === "loading" && !this.state.data && !next.authExpired) {
          // Keep a deep link on first launch so login or demo can open it.
          this.newGeneration();
          this.update({ phase: "login", data: null, busy: false, error: null });
        } else this.signedOut(next.authExpired ? SESSION_EXPIRED : null);
        return;
      }
      this.options.onFeed?.(next, this.previousSync);
      this.previousSync = next.lastSync;
      this.update({ data: next, phase: next.mode, error: null });
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 401) this.signedOut(SESSION_EXPIRED);
      else this.update({ error: (error as Error).message,
        ...(this.state.phase === "loading" ? { phase: "login" as const } : {}) });
    } finally {
      if (current()) this.currentLoad = null;
    }
  };
  login = async (username: string, password: string) => {
    const version = this.newGeneration();
    this.authPending = true;
    this.update({ busy: true, error: null });
    try {
      await this.request("/api/auth/login", { username, password });
      if (version !== this.generation.current) return;
      this.authPending = false;
      this.mode = "live";
      this.update({ phase: "loading", data: null });
      await this.load();
    } catch (error) {
      if (version === this.generation.current) this.update({ error: (error as Error).message });
    } finally {
      if (version === this.generation.current) {
        this.authPending = false;
        this.update({ busy: false });
      }
    }
  };
  showDemo = async () => {
    this.newGeneration();
    this.authPending = false;
    this.mode = "demo";
    this.update({ phase: "loading", data: null, busy: false, error: null });
    await this.load();
  };
  logout = async () => {
    const version = this.newGeneration();
    this.authPending = true;
    this.update({ busy: true });
    try {
      await this.request("/api/auth/logout", {});
      if (version === this.generation.current) this.signedOut();
    } catch (error) {
      if (version === this.generation.current) this.update({ error: (error as Error).message });
    } finally {
      if (version === this.generation.current) {
        this.authPending = false;
        this.update({ busy: false });
      }
    }
  };
  refresh = async () => {
    const version = this.generation.current;
    this.cancelLoad();
    this.update({ busy: true, error: null });
    try {
      if (this.mode === "live") await this.request("/api/sync", {});
      if (version === this.generation.current) await this.load();
    } catch (error) {
      if (version !== this.generation.current) return;
      if (error instanceof ApiError && error.status === 401) this.signedOut(SESSION_EXPIRED);
      else this.update({ error: (error as Error).message });
    } finally {
      if (version === this.generation.current) this.update({ busy: false });
    }
  };
  markResourceViewed = async (resourceId: string) => {
    const version = this.generation.current;
    const changes = (this.state.data?.changes ?? []).filter((change) => change.resourceId === resourceId && !change.read);
    if (!changes.length) return;
    const results = await Promise.allSettled(changes.map(async (change) => {
      if (this.mode === "live") await this.request("/api/changes/read", { id: change.id });
      return change.id;
    }));
    if (version !== this.generation.current) return;
    if (results.some((result) => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401)) {
      this.signedOut(SESSION_EXPIRED);
      return;
    }
    const read = new Set(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    // An already pending snapshot may still contain unread notifications.
    this.cancelLoad();
    const data = this.state.data;
    if (data) this.update({ data: { ...data, changes: data.changes.map((change) => read.has(change.id) ? { ...change, read: true } : change) } });
  };
  saveGitlabProject = async (courseId: string, url: string | null) => {
    const version = this.generation.current;
    try {
      const result = await this.request<{ project: GitlabProject | null }>(`/api/courses/${encodeURIComponent(courseId)}/gitlab`, { url });
      if (version !== this.generation.current || !this.state.data) return;
      this.cancelLoad();
      const gitlabProjects = { ...this.state.data.gitlabProjects };
      if (result.project) gitlabProjects[courseId] = result.project;
      else delete gitlabProjects[courseId];
      this.update({ data: { ...this.state.data, gitlabProjects } });
    } catch (error) {
      if (version === this.generation.current && error instanceof ApiError && error.status === 401) this.signedOut(SESSION_EXPIRED);
      throw error;
    }
  };
}
