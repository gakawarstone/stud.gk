import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";

function PdfPage({
  pdf,
  number,
  width,
  themed,
  initialRatio,
  scrollRoot,
  onRendered,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  themed: boolean;
  initialRatio: number;
  scrollRoot: HTMLElement | null;
  onRendered: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const [visible, setVisible] = useState(number === 1);
  const renderedCallback = useRef(onRendered);
  renderedCallback.current = onRendered;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
    let cancelled = false;
    void pdf
      .getPage(number)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        setRatio(viewport.height / viewport.width);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdf, number]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    observer.observe(slot.current!);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible) {
      container.current?.replaceChildren();
      return;
    }
    const controller = new AbortController();
    const element = container.current!;
    element.replaceChildren();
    setStatus("loading");
    void import("./pdf-document")
      .then(({ renderPdfPage }) =>
        renderPdfPage(pdf, number, width, controller.signal, themed),
      )
      .then((surface) => {
        if (controller.signal.aborted) return;
        element.replaceChildren(surface);
        setStatus("ready");
        renderedCallback.current();
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [pdf, number, width, visible, themed]);

  return (
    <div
      className="pdf-page"
      ref={slot}
      data-page={number}
      style={{ width, height: width * ratio }}
      aria-label={`Page ${number}`}
      aria-busy={visible && status === "loading"}
    >
      {visible && status !== "ready" && (
        <div className="pdf-viewer-status" role="status">
          {status === "loading" ? (
            <>
              <LoaderCircle className="spin" size={24} /> Loading page…
            </>
          ) : (
            <>
              <TriangleAlert size={24} /> Could not display the page.
            </>
          )}
        </div>
      )}
      <div className="pdf-page-content" ref={container} />
    </div>
  );
}

export function PdfViewer({
  title,
  remoteId,
  contentUrl,
  downloadUrl,
  onClose,
  onViewed,
}: {
  title: string;
  onClose: () => void;
  onViewed?: () => void;
} & ({ remoteId: string; contentUrl?: never; downloadUrl?: never } | { remoteId?: never; contentUrl: string; downloadUrl: string })) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fullscreenContainer = useRef<HTMLDivElement>(null);
  const documentArea = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const readingPosition = useRef({ page: 1, fraction: 0 });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [themed, setThemed] = useState(true);
  const [width, setWidth] = useState(800);
  const [initialRatio, setInitialRatio] = useState(1.4);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const enteredFullscreen = useRef(false);
  const viewed = useRef(false);
  const fileUrl = `/api/files/${encodeURIComponent(remoteId || "")}`;
  const previewUrl = contentUrl || `${fileUrl}/preview`;
  const saveUrl = downloadUrl || `${fileUrl}/download`;

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    const area = documentArea.current!;
    area.focus({ preventScroll: true });
    const updateWidth = () => {
      setWidth(Math.max(120, Math.min(1000, area.clientWidth - 48)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(area);
    const trackFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    trackFullscreen();
    document.addEventListener("fullscreenchange", trackFullscreen);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", trackFullscreen);
      if (enteredFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setFailed(false);
    void import("./pdf-document")
      .then(({ openPdfDocument }) => {
        if (cancelled) return;
        task = openPdfDocument(previewUrl);
        return task.promise;
      })
      .then(async (document) => {
        if (cancelled || !document) return;
        const first = await document.getPage(1);
        if (cancelled) return;
        const viewport = first.getViewport({ scale: 1 });
        setInitialRatio(viewport.height / viewport.width);
        setPdf(document);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
    };
  }, [previewUrl, attempt]);

  useEffect(() => {
    if (document.activeElement !== numberInput.current)
      setPageInput(String(page));
  }, [page]);

  useLayoutEffect(() => {
    const area = documentArea.current;
    const list = pages.current;
    if (!area || !list) return;
    const position = readingPosition.current;
    const target = list.children[position.page - 1] as HTMLElement | undefined;
    if (target)
      area.scrollTop =
        list.offsetTop +
        target.offsetTop +
        target.offsetHeight * position.fraction -
        (position.fraction === 0 ? 12 : 0);
  }, [width, zoom]);

  function pageAtOffset(list: HTMLDivElement, offset: number) {
    let start = 0;
    let end = list.children.length - 1;
    while (start < end) {
      const middle = Math.ceil((start + end) / 2);
      if ((list.children[middle] as HTMLElement).offsetTop <= offset)
        start = middle;
      else end = middle - 1;
    }
    return start;
  }

  function trackScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const area = documentArea.current;
      const list = pages.current;
      if (!area || !list?.children.length) return;
      const top = area.scrollTop - list.offsetTop;
      const active = pageAtOffset(list, top + area.clientHeight * 0.3);
      setPage(active + 1);
      const first = pageAtOffset(list, top);
      const element = list.children[first] as HTMLElement;
      readingPosition.current = {
        page: first + 1,
        fraction: Math.max(0, (top - element.offsetTop) / element.offsetHeight),
      };
    });
  }

  function goToPage(number: number) {
    if (!pdf) return;
    const next = Math.min(pdf.numPages, Math.max(1, number));
    setPage(next);
    setPageInput(String(next));
    const area = documentArea.current;
    const list = pages.current;
    const target = list?.children[next - 1] as HTMLElement | undefined;
    if (area && list && target) {
      readingPosition.current = { page: next, fraction: 0 };
      area.scrollTo({ top: list.offsetTop + target.offsetTop - 12 });
    }
  }
  function applyPageInput() {
    const next = Number(pageInput);
    if (Number.isInteger(next) && next > 0) goToPage(next);
    else setPageInput(String(page));
  }

  async function toggleFullscreen() {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        enteredFullscreen.current = false;
      } else {
        await fullscreenContainer.current!.requestFullscreen();
        enteredFullscreen.current = true;
      }
    } catch {
      setFullscreenError("The browser did not allow fullscreen mode.");
    }
  }

  function fitToWidth() {
    const area = documentArea.current;
    if (area)
      setZoom(Math.max(0.5, Math.min(3, (area.clientWidth - 48) / width)));
  }

  return (
    <dialog
      className="pdf-viewer"
      data-themed={themed}
      ref={dialog}
      aria-labelledby="pdf-viewer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (!pdf || (event.target as Element).closest("input, button, a"))
          return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          goToPage(page + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}
    >
      <div className="pdf-viewer-shell" ref={fullscreenContainer}>
        <header className="pdf-viewer-toolbar">
          <h2 id="pdf-viewer-title">{title}</h2>
          <nav className="pdf-viewer-controls" aria-label="PDF controls">
            <div className="pdf-control-group">
              <button
                className="pdf-viewer-action"
                disabled={!pdf || page === 1}
                onClick={() => goToPage(page - 1)}
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft size={20} />
              </button>
              <form
                className="pdf-page-number"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyPageInput();
                }}
              >
                <input
                  ref={numberInput}
                  type="number"
                  min={1}
                  max={pdf?.numPages || 1}
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onBlur={applyPageInput}
                  disabled={!pdf}
                  aria-label="Page number"
                />
                <span>/ {pdf?.numPages || "…"}</span>
              </form>
              <button
                className="pdf-viewer-action"
                disabled={!pdf || page === pdf.numPages}
                onClick={() => goToPage(page + 1)}
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="pdf-control-group">
              <button
                className="pdf-viewer-action"
                disabled={!pdf || zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={18} />
              </button>
              <button
                className="pdf-zoom-value"
                disabled={!pdf}
                onClick={fitToWidth}
                aria-label="Fit to width"
                title="Fit to width"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="pdf-viewer-action"
                disabled={!pdf || zoom >= 3}
                onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={18} />
              </button>
              <button
                className="pdf-viewer-action"
                disabled={!pdf}
                onClick={() => void toggleFullscreen()}
                aria-label={
                  fullscreen
                    ? "Exit fullscreen"
                    : "Enter fullscreen"
                }
                title={
                  fullscreen
                    ? "Exit fullscreen"
                    : "Enter fullscreen"
                }
              >
                {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          </nav>
          <div className="pdf-viewer-actions">
            <button
              className="pdf-viewer-action"
              onClick={() => setThemed((value) => !value)}
              aria-label="Catppuccin colors"
              aria-pressed={themed}
              title={
                themed
                  ? "Show original colors"
                  : "Apply Catppuccin colors"
              }
            >
              <Palette size={18} />
            </button>
            <a
              className="pdf-viewer-action"
              href={saveUrl}
              aria-label="Download PDF"
              title="Download PDF"
            >
              <Download size={18} />
            </a>
            <button
              className="pdf-viewer-action"
              onClick={onClose}
              aria-label="Close preview"
              title="Close preview"
            >
              <X size={20} />
            </button>
          </div>
        </header>
        {fullscreenError && (
          <div className="pdf-viewer-notice" role="alert">
            {fullscreenError}
          </div>
        )}
        <div
          className="pdf-viewer-document"
          ref={documentArea}
          tabIndex={0}
          aria-label="PDF content"
          onScroll={trackScroll}
        >
          {pdf ? (
            <div className="pdf-pages" ref={pages}>
              {Array.from({ length: pdf.numPages }, (_, index) => (
                <PdfPage
                  key={index + 1}
                  pdf={pdf}
                  number={index + 1}
                  width={width * zoom}
                  themed={themed}
                  initialRatio={initialRatio}
                  scrollRoot={documentArea.current}
                  onRendered={() => {
                    if (viewed.current) return;
                    viewed.current = true;
                    onViewed?.();
                  }}
                />
              ))}
            </div>
          ) : (
            <div
              className="pdf-viewer-status"
              role={failed ? "alert" : "status"}
            >
              {failed ? (
                <>
                  <TriangleAlert size={28} />
                  <p>Could not open the PDF.</p>
                  <button
                    className="text-button"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <LoaderCircle className="spin" size={28} />
                  <p>Loading PDF…</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
