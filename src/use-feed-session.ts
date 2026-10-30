import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FeedSession } from "./feed-session";
import { clearThumbnailCache } from "./FileThumbnail";
import type { Feed } from "../shared/studip";

function notifyNewFiles(feed: Feed, previousSync: string | null) {
  if (!previousSync || feed.mode !== "live" || feed.lastSync === previousSync) return;
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || localStorage.getItem("campus-notifications") !== "true") return;
    const fresh = feed.changes.filter((change) => !change.read && change.kind === "file" && change.action !== "removed" && Date.parse(change.occurredAt) > Date.parse(previousSync));
    if (fresh.length) new Notification("Stud.GK · New changes", {
      body: `${fresh.length} ${fresh.length === 1 ? "update" : "updates"} in your courses.`, icon: "/favicon.svg",
    });
  } catch { /* Notifications and browser storage are optional. */ }
}

export function useFeedSession(onSignedOut: () => void) {
  const reset = useRef(onSignedOut);
  reset.current = onSignedOut;
  const [session] = useState(() => new FeedSession({
    onSignedOut: () => reset.current(), onSessionChange: clearThumbnailCache, onFeed: notifyNewFiles,
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    void session.load();
    return session.dispose;
  }, [session]);
  useEffect(() => {
    if (state.phase !== "live") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        await session.load();
        if (!stopped) schedule();
      }, session.getSnapshot().data?.syncing ? 2000 : 30000);
    };
    schedule();
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, state.phase, state.data?.syncing]);
  return {
    ...state, generation: session.generation,
    load: session.load, signedOut: session.signedOut, login: session.login,
    showDemo: session.showDemo, logout: session.logout, refresh: session.refresh,
    markResourceViewed: session.markResourceViewed, saveGitlabProject: session.saveGitlabProject,
  };
}
