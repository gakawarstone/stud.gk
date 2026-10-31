interface Window {
  studGkDesktop?: {
    chooseProjectDirectory: () => Promise<string | null>;
    openIdeaProject: (directory: string) => Promise<{ ok: true; path: string } | { ok: false; error: string; path?: string }>;
  };
}
