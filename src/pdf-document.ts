import {
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  TextLayer,
} from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
let worker: PDFWorker | undefined;

export function openPdfDocument(url: string) {
  worker ??= new PDFWorker();
  return getDocument({
    url,
    worker,
    withCredentials: true,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: "/pdf-assets/cmaps/",
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/",
    iccUrl: "/pdf-assets/iccs/",
  });
}

export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  number: number,
  width: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const page = await pdf.getPage(number);
  signal.throwIfAborted();
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / original.width });
  const density = Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
  );
  const surface = document.createElement("div");
  surface.className = "pdf-page-surface";
  surface.style.width = `${viewport.width}px`;
  surface.style.height = `${viewport.height}px`;
  surface.style.setProperty("--total-scale-factor", String(viewport.scale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width * density);
  canvas.height = Math.ceil(viewport.height * density);
  canvas.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "pdf-text-layer";
  surface.append(canvas, text);
  const rendering = page.render({
    canvas,
    viewport,
    transform: [density, 0, 0, density, 0, 0],
    background: "white",
  });
  const layer = new TextLayer({
    container: text,
    textContentSource: page.streamTextContent(),
    viewport,
  });
  const cancel = () => {
    rendering.cancel();
    layer.cancel();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await Promise.all([rendering.promise, layer.render()]);
    signal.throwIfAborted();
    return surface;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
