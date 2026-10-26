import { createEffect, createMemo, on, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Feed } from "../shared/studip";
import { FeedSession } from "./feed-session";
import { clearThumbnailCache } from "./FileThumbnail";

function notifyNewFiles(feed: Feed, previousSync: string | null) {
  if (!previousSync || feed.mode !== "live" || feed.lastSync === previousSync)
    return;
  try {
    if (
      !("Notification" in window) ||
      Notification.permission !== "granted" ||
      localStorage.getItem("campus-notifications") !== "true"
    )
      return;
    const fresh = feed.changes.filter(
      (change) =>
        !change.read &&
        change.kind === "file" &&
        change.action !== "removed" &&
        Date.parse(change.occurredAt) > Date.parse(previousSync),
    );
    if (fresh.length)
      new Notification("Stud.GK · Новые изменения", {
        body: `${fresh.length} обновлений в твоих курсах.`,
        icon: "/favicon.svg",
      });
  } catch {
    /* Notifications and browser storage are optional. */
  }
}

export function createFeedSession(onSignedOut: () => void) {
  const session = new FeedSession({
    onSignedOut,
    onSessionChange: clearThumbnailCache,
    onFeed: notifyNewFiles,
  });
  // Preserve courses/resources by ID across polling, so keyed lists retain
  // focus and expanded posts. Clone to keep the mutable store separate from
  // FeedSession's immutable snapshots and stale-response guards.
  const [state, setState] = createStore(structuredClone(session.getSnapshot()));
  const unsubscribe = session.subscribe(() =>
    setState(reconcile(structuredClone(session.getSnapshot()))),
  );
  onCleanup(() => {
    unsubscribe();
    session.dispose();
  });
  onMount(() => {
    void session.load();
  });
  const phase = createMemo(() => state.phase);
  // Only one poll may run. A phase/syncing change cancels the old schedule;
  // an in-flight load must finish before its next timeout is scheduled.
  createEffect(
    on(
      () => [phase(), state.data?.syncing] as const,
      ([phase]) => {
        if (phase !== "live") return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const schedule = () => {
          timer = setTimeout(
            async () => {
              await session.load();
              if (!stopped) schedule();
            },
            session.getSnapshot().data?.syncing ? 2000 : 30000,
          );
        };
        schedule();
        onCleanup(() => {
          stopped = true;
          clearTimeout(timer);
        });
      },
    ),
  );
  return {
    phase,
    data: createMemo(() => state.data),
    busy: createMemo(() => state.busy),
    error: createMemo(() => state.error),
    generation: session.generation,
    load: session.load,
    signedOut: session.signedOut,
    login: session.login,
    showDemo: session.showDemo,
    logout: session.logout,
    refresh: session.refresh,
    markResourceViewed: session.markResourceViewed,
    saveGitlabProject: session.saveGitlabProject,
  };
}
