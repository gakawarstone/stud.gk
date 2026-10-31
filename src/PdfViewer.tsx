import { Dynamic } from "solid-js/web";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  TriangleAlert,
  X,
} from "lucide-solid";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup } from "solid-js";
import { pdfWindowUrl, type PdfViewState } from "./pdf-window";
function PdfPage(props: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  themed: boolean;
  initialRatio: number;
  scrollRoot: HTMLElement | null;
  onRendered: () => void;
}) {
  let container: HTMLDivElement | null = null;
  let slot: HTMLDivElement | null = null;
  const [ratio, setRatio] = createSignal(props.initialRatio);
  const [visible, setVisible] = createSignal(props.number === 1);
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading");
  createEffect(
    on(
      () => [props.pdf, props.number],
      () => {
        let cancelled = false;
        void props.pdf
          .getPage(props.number)
          .then((page) => {
            if (cancelled) return;
            const viewport = page.getViewport({ scale: 1 });
            setRatio(viewport.height / viewport.width);
          })
          .catch(() => {});
        onCleanup(() => {
          cancelled = true;
        });
      },
    ),
  );
  createEffect(
    on(
      () => [props.scrollRoot],
      () => {
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
          root: props.scrollRoot,
          rootMargin: "600px 0px",
        });
        observer.observe(slot!);
        onCleanup(() => observer.disconnect());
      },
    ),
  );
  createEffect(
    on(
      () => [props.pdf, props.number, props.width, visible(), props.themed],
      () => {
        if (!visible()) {
          container?.replaceChildren();
          return;
        }
        const controller = new AbortController();
        const element = container!;
        element.replaceChildren();
        setStatus("loading");
        void import("./pdf-document")
          .then(({ renderPdfPage }) =>
            renderPdfPage(props.pdf, props.number, props.width, controller.signal, props.themed),
          )
          .then((surface) => {
            if (controller.signal.aborted) return;
            element.replaceChildren(surface);
            setStatus("ready");
            props.onRendered();
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus("error");
          });
        onCleanup(() => controller.abort());
      },
    ),
  );
  return (
    <div
      class="pdf-page"
      ref={(element) => (slot = element)}
      data-page={props.number}
      style={{
        width: `${props.width}px`,
        height: `${props.width * ratio()}px`,
      }}
      aria-label={`Page ${props.number}`}
      aria-busy={visible() && status() === "loading"}
    >
      {visible() && status() !== "ready" && (
        <div class="pdf-viewer-status" role="status">
          {status() === "loading" ? (
            <>
              <LoaderCircle class="spin" size={24} /> Loading page…
            </>
          ) : (
            <>
              <TriangleAlert size={24} /> Could not display the page.
            </>
          )}
        </div>
      )}
      <div class="pdf-page-content" ref={(element) => (container = element)} />
    </div>
  );
}
export function PdfViewer(
  props: {
    title: string;
    onClose: () => void;
    onViewed?: () => void;
    embedded?: boolean;
    detached?: boolean;
    initialView?: PdfViewState;
  } & (
    | {
        remoteId: string;
        contentUrl?: never;
        downloadUrl?: never;
      }
    | {
        remoteId?: never;
        contentUrl: string;
        downloadUrl: string;
      }
  ),
) {
  const titleId = createUniqueId();
  let dialog: HTMLDialogElement | null = null;
  let fullscreenContainer: HTMLDivElement | null = null;
  let documentArea: HTMLDivElement | null = null;
  let pages: HTMLDivElement | null = null;
  let numberInput: HTMLInputElement | null = null;
  let scrollFrame: (number | null) | null = null;
  let readingPosition = { page: props.initialView?.page ?? 1, fraction: props.initialView?.fraction ?? 0 };
  const [pdf, setPdf] = createSignal<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [attempt, setAttempt] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [pageInput, setPageInput] = createSignal("1");
  const [zoom, setZoom] = createSignal(props.initialView?.zoom ?? 1);
  const [themed, setThemed] = createSignal(props.initialView?.themed ?? true);
  const [width, setWidth] = createSignal(800);
  const [initialRatio, setInitialRatio] = createSignal(1.4);
  const [fullscreen, setFullscreen] = createSignal(false);
  const [fullscreenError, setFullscreenError] = createSignal<string | null>(null);
  const [windowError, setWindowError] = createSignal<string | null>(null);
  let enteredFullscreen = false;
  let viewed = false;
  const fileUrl = createMemo(() => `/api/files/${encodeURIComponent(props.remoteId || "")}`);
  const previewUrl = createMemo(() => props.contentUrl || `${fileUrl()}/preview`);
  const saveUrl = createMemo(() => props.downloadUrl || `${fileUrl()}/download`);
  createEffect(
    on(
      () => props.embedded,
      (embedded) => {
        const element = dialog;
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        if (!embedded) {
          document.body.style.overflow = "hidden";
          element!.showModal();
        }
        const area = documentArea!;
        area.focus({ preventScroll: true });
        const updateWidth = () => {
          setWidth(Math.max(120, Math.min(1000, area.clientWidth - 48)));
        };
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(area);
        const trackFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
        trackFullscreen();
        document.addEventListener("fullscreenchange", trackFullscreen);
        onCleanup(() => {
          observer.disconnect();
          document.removeEventListener("fullscreenchange", trackFullscreen);
          if (enteredFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
          if (!embedded) {
            element!.close();
            document.body.style.overflow = previousOverflow;
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
              previousFocus.focus({ preventScroll: true });
          }
        });
      },
    ),
  );
  createEffect(
    on(
      () => [previewUrl(), attempt()],
      () => {
        let cancelled = false;
        let task: PDFDocumentLoadingTask | undefined;
        setPdf(null);
        setFailed(false);
        void import("./pdf-document")
          .then(({ openPdfDocument }) => {
            if (cancelled) return;
            task = openPdfDocument(previewUrl());
            return task.promise;
          })
          .then(async (document) => {
            if (cancelled || !document) return;
            const first = await document.getPage(1);
            if (cancelled) return;
            const viewport = first.getViewport({ scale: 1 });
            setInitialRatio(viewport.height / viewport.width);
            setPdf(document);
            if (props.initialView) {
              const position = { ...readingPosition };
              requestAnimationFrame(() => {
                if (cancelled) return;
                goToPage(position.page);
                const target = pages?.children[page() - 1] as HTMLElement | undefined;
                if (documentArea && target) documentArea.scrollTop += target.offsetHeight * position.fraction;
              });
            }
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
        onCleanup(() => {
          cancelled = true;
          void task?.destroy().catch(() => {});
        });
      },
    ),
  );
  createEffect(
    on(
      () => [page()],
      () => {
        if (document.activeElement !== numberInput) setPageInput(String(page()));
      },
    ),
  );
  createEffect(
    on(
      () => [width(), zoom()],
      () => {
        const area = documentArea;
        const list = pages;
        if (!area || !list) return;
        const position = readingPosition;
        const target = list.children[position.page - 1] as HTMLElement | undefined;
        if (target)
          area.scrollTop =
            list.offsetTop +
            target.offsetTop +
            target.offsetHeight * position.fraction -
            (position.fraction === 0 ? 12 : 0);
      },
    ),
  );
  function pageAtOffset(list: HTMLDivElement, offset: number) {
    let start = 0;
    let end = list.children.length - 1;
    while (start < end) {
      const middle = Math.ceil((start + end) / 2);
      if ((list.children[middle] as HTMLElement).offsetTop <= offset) start = middle;
      else end = middle - 1;
    }
    return start;
  }
  function trackScroll() {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const area = documentArea;
      const list = pages;
      if (!area || !list?.children.length) return;
      const top = area.scrollTop - list.offsetTop;
      const active = pageAtOffset(list, top + area.clientHeight * 0.3);
      setPage(active + 1);
      const first = pageAtOffset(list, top + 12);
      const element = list.children[first] as HTMLElement;
      readingPosition = {
        page: first + 1,
        fraction: Math.max(0, Math.min(1, (top - element.offsetTop) / element.offsetHeight)),
      };
    });
  }
  function goToPage(number: number) {
    if (!pdf()) return;
    const next = Math.min(pdf()!.numPages, Math.max(1, number));
    setPage(next);
    setPageInput(String(next));
    const area = documentArea;
    const list = pages;
    const target = list?.children[next - 1] as HTMLElement | undefined;
    if (area && list && target) {
      readingPosition = { page: next, fraction: 0 };
      area.scrollTo({ top: list.offsetTop + target.offsetTop - 12 });
    }
  }
  function applyPageInput() {
    const next = Number(pageInput());
    if (Number.isInteger(next) && next > 0) goToPage(next);
    else setPageInput(String(page()));
  }
  async function toggleFullscreen() {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        enteredFullscreen = false;
      } else {
        await fullscreenContainer!.requestFullscreen();
        enteredFullscreen = true;
      }
    } catch {
      setFullscreenError("The browser did not allow fullscreen mode.");
    }
  }
  function fitToWidth() {
    const area = documentArea;
    if (area) setZoom(Math.max(0.5, Math.min(3, (area.clientWidth - 48) / width())));
  }
  function openSeparateWindow() {
    setWindowError(null);
    try {
      const child = window.open(pdfWindowUrl({
        title: props.title,
        contentUrl: previewUrl(),
        downloadUrl: saveUrl(),
        ...readingPosition,
        zoom: zoom(),
        themed: themed(),
      }), "_blank", "popup,width=1100,height=850");
      if (!child) {
        setWindowError("The window could not open. Allow pop-ups for Stud.GK and try again.");
        return;
      }
      child.opener = null;
    } catch {
      setWindowError("The window could not open. Try again.");
    }
  }
  return (
    <Dynamic
      component={props.embedded ? "section" : "dialog"}
      class={`pdf-viewer${props.embedded ? " pdf-viewer-embedded" : ""}`}
      data-themed={themed()}
      ref={(element: HTMLElement) => {
        dialog = element instanceof HTMLDialogElement ? element : null;
      }}
      aria-labelledby={titleId}
      onCancel={(event: Event) => {
        event.preventDefault();
        props.onClose();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (props.embedded && event.key === "Escape") {
          event.preventDefault();
          props.onClose();
          return;
        }
        if (!pdf() || (event.target as Element).closest("input, button, a")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          goToPage(page() + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}
    >
      <div class="pdf-viewer-shell" ref={(element) => (fullscreenContainer = element)}>
        <header class="pdf-viewer-toolbar">
          <h2 id={titleId}>{props.title}</h2>
          <nav class="pdf-viewer-controls" aria-label="PDF controls">
            <div class="pdf-control-group">
              <button
                class="pdf-viewer-action"
                disabled={!pdf() || page() === 1}
                onClick={() => goToPage(page() - 1)}
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft size={20} />
              </button>
              <form
                class="pdf-page-number"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyPageInput();
                }}
              >
                <input
                  ref={(element) => (numberInput = element)}
                  type="number"
                  min={1}
                  max={pdf()?.numPages || 1}
                  value={pageInput()}
                  onInput={(event) => setPageInput(event.target.value)}
                  onBlur={applyPageInput}
                  disabled={!pdf()}
                  aria-label="Page number"
                />
                <span>/ {pdf()?.numPages || "…"}</span>
              </form>
              <button
                class="pdf-viewer-action"
                disabled={!pdf() || page() === pdf()!.numPages}
                onClick={() => goToPage(page() + 1)}
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div class="pdf-control-group">
              <button
                class="pdf-viewer-action"
                disabled={!pdf() || zoom() <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={18} />
              </button>
              <button
                class="pdf-zoom-value"
                disabled={!pdf()}
                onClick={fitToWidth}
                aria-label="Fit to width"
                title="Fit to width"
              >
                {Math.round(zoom() * 100)}%
              </button>
              <button
                class="pdf-viewer-action"
                disabled={!pdf() || zoom() >= 3}
                onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={18} />
              </button>
              <button
                class="pdf-viewer-action"
                disabled={!pdf()}
                onClick={() => void toggleFullscreen()}
                aria-label={fullscreen() ? "Exit fullscreen" : "Enter fullscreen"}
                title={fullscreen() ? "Exit fullscreen" : "Enter fullscreen"}
              >
                {fullscreen() ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          </nav>
          <div class="pdf-viewer-actions">
            <button
              class="pdf-viewer-action"
              onClick={() => setThemed((value) => !value)}
              aria-label="Catppuccin colors"
              aria-pressed={themed()}
              title={themed() ? "Show original colors" : "Apply Catppuccin colors"}
            >
              <Palette size={18} />
            </button>
            {!props.detached && (
              <button
                class="pdf-viewer-action"
                onClick={openSeparateWindow}
                aria-label="Open in separate window"
                title="Open in separate window"
              >
                <ExternalLink size={18} />
              </button>
            )}
            <a class="pdf-viewer-action" href={saveUrl()} aria-label="Download PDF" title="Download PDF">
              <Download size={18} />
            </a>
            <button class="pdf-viewer-action" onClick={props.onClose} aria-label="Close preview" title="Close preview">
              <X size={20} />
            </button>
          </div>
        </header>
        {(fullscreenError() || windowError()) && (
          <div class="pdf-viewer-notice" role="alert">
            {fullscreenError() || windowError()}
          </div>
        )}
        <div
          class="pdf-viewer-document"
          ref={(element) => (documentArea = element)}
          tabindex={0}
          aria-label="PDF content"
          onScroll={trackScroll}
        >
          {pdf() ? (
            <div class="pdf-pages" ref={(element) => (pages = element)}>
              {Array.from({ length: pdf()!.numPages }, (_, index) => (
                <PdfPage
                  pdf={pdf()!}
                  number={index + 1}
                  width={width() * zoom()}
                  themed={themed()}
                  initialRatio={initialRatio()}
                  scrollRoot={documentArea}
                  onRendered={() => {
                    if (viewed) return;
                    viewed = true;
                    props.onViewed?.();
                  }}
                />
              ))}
            </div>
          ) : (
            <div class="pdf-viewer-status" role={failed() ? "alert" : "status"}>
              {failed() ? (
                <>
                  <TriangleAlert size={28} />
                  <p>Could not open the PDF.</p>
                  <button class="text-button" onClick={() => setAttempt((value) => value + 1)}>
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <LoaderCircle class="spin" size={28} />
                  <p>Loading PDF…</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Dynamic>
  );
}
