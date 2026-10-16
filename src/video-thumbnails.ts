let active = 0;
const waiting: Array<() => void> = [];

export function videoFrameBounds({ data, width, height }: Pick<ImageData, "data" | "width" | "height">) {
  function blackLine(x: number, y: number, dx: number, dy: number, length: number) {
    let nonBlack = 0;
    for (let i = 0; i < length; i++) {
      const offset = ((y + i * dy) * width + x + i * dx) * 4;
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 16 && ++nonBlack > length * 0.01) return false;
    }
    return true;
  }
  let top = 0, bottom = height, left = 0, right = width;
  while (top < height / 4 && blackLine(0, top, 1, 0, width)) top++;
  while (bottom > height * 3 / 4 && blackLine(0, bottom - 1, 1, 0, width)) bottom--;
  // A dark scene is not a border. Only trim bounded, opposing black edges.
  if (!top || bottom === height || top >= height / 4 || bottom <= height * 3 / 4) { top = 0; bottom = height; }
  while (left < width / 4 && blackLine(left, top, 0, 1, bottom - top)) left++;
  while (right > width * 3 / 4 && blackLine(right - 1, top, 0, 1, bottom - top)) right--;
  if (!left || right === width || left >= width / 4 || right <= width * 3 / 4) { left = 0; right = width; }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

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
        const bounds = videoFrameBounds(context.getImageData(0, 0, canvas.width, canvas.height));
        const cropped = document.createElement("canvas");
        cropped.width = bounds.width;
        cropped.height = bounds.height;
        const croppedContext = cropped.getContext("2d");
        if (!croppedContext) throw new Error("Canvas is unavailable");
        croppedContext.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        finish(undefined, cropped.toDataURL("image/webp", 0.85));
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
