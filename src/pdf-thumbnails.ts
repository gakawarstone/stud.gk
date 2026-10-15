import { applyPdfTheme, openPdfDocument } from "./pdf-document";

export async function renderPdfThumbnail(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const task = openPdfDocument(url);
  const cancel = () => {
    void task.destroy().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const document = await task.promise;
    signal.throwIfAborted();
    const page = await document.getPage(1);
    const original = page.getViewport({ scale: 1 });
    // Render enough detail for the thumbnail to fill a tile at 2× density.
    const viewport = page.getViewport({
      scale: Math.min(
        Math.max(720 / original.width, 540 / original.height),
        1600 / Math.max(original.width, original.height),
      ),
    });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "white" }).promise;
    signal.throwIfAborted();
    applyPdfTheme(canvas);
    signal.throwIfAborted();
    return canvas.toDataURL("image/webp", 0.85);
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
