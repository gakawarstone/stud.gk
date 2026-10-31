export type PdfViewState = {
  page: number;
  fraction: number;
  zoom: number;
  themed: boolean;
};

export type PdfWindowState = PdfViewState & {
  title: string;
  contentUrl: string;
  downloadUrl: string;
};

export function pdfWindowUrl(state: PdfWindowState) {
  return `/#pdf=${encodeURIComponent(JSON.stringify(state))}`;
}

// Detached windows only fetch through the app's authenticated, same-origin API.
export function readPdfWindowState(hash: string, origin: string): PdfWindowState | null {
  try {
    const value = JSON.parse(new URLSearchParams(hash.slice(1)).get("pdf") || "null");
    if (!value || typeof value.title !== "string" || typeof value.themed !== "boolean") return null;
    for (const key of ["contentUrl", "downloadUrl"]) {
      if (typeof value[key] !== "string") return null;
      const url = new URL(value[key], origin);
      if (url.origin !== origin || !url.pathname.startsWith("/api/") || url.username || url.password) return null;
    }
    if (!Number.isInteger(value.page) || value.page < 1 ||
        !Number.isFinite(value.fraction) || value.fraction < 0 || value.fraction > 1 ||
        !Number.isFinite(value.zoom) || value.zoom < 0.5 || value.zoom > 3) return null;
    return value;
  } catch {
    return null;
  }
}
