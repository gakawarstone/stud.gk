let active = 0;
const waiting: Array<() => void> = [];

function acquire(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", cancel);
      active++;
      resolve(() => { active--; waiting.shift()?.(); });
    };
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index !== -1) waiting.splice(index, 1);
      reject(signal.reason);
    };
    if (active < 2) start();
    else {
      waiting.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

function captureFrame(url: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let target: number | null = null;
    let finished = false;
    const timer = setTimeout(() => finish(new Error("Video thumbnail timed out")), 20000);
    const cancel = () => finish(signal.reason || new DOMException("Aborted", "AbortError"));
    function finish(error?: unknown, src?: string) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (error) reject(error);
      else resolve(src!);
    }
    function capture() {
      if (target === null || video.seeking || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(undefined, canvas.toDataURL("image/webp", 0.85));
      } catch (error) { finish(error); }
    }
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      // Skip the opening frame while keeping short clips seekable.
      target = Number.isFinite(video.duration) ? Math.min(5, Math.max(0, video.duration / 10)) : 1;
      if (target > 0) video.currentTime = target;
      else capture();
    };
    video.onseeked = capture;
    video.onloadeddata = capture;
    video.onerror = () => finish(new Error("Video preview is unavailable"));
    signal.addEventListener("abort", cancel, { once: true });
    video.src = url;
    video.load();
  });
}

export async function renderVideoThumbnail(url: string, signal: AbortSignal) {
  const release = await acquire(signal);
  try { return await captureFrame(url, signal); }
  finally { release(); }
}
