import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { PdfViewer } from "./PdfViewer";

export type NextcloudEntry = {
  path: string;
  name: string;
  directory: boolean;
  mime: string;
  size: number;
  modified: string | null;
  etag: string;
};

export function nextcloudFileKind(file: NextcloudEntry) {
  if (file.mime === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.mime.startsWith("video/") || /\.(mp4|webm|ogv|mov)$/i.test(file.name)) return "video";
  if (file.mime.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac)$/i.test(file.name)) return "audio";
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.mime) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name)) return "image";
  if (file.mime.startsWith("text/") || /\.(txt|md|csv|json|html?|svg|js|ts|css|py|java|kt|xml|ya?ml)$/i.test(file.name)) return "text";
  return "other";
}

export function NextcloudViewer({ file, contentUrl, downloadUrl, onClose }: {
  file: NextcloudEntry;
  contentUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const kind = nextcloudFileKind(file);
  return kind === "pdf" ? <PdfViewer title={file.name} contentUrl={contentUrl} downloadUrl={downloadUrl} onClose={onClose} />
    : <MediaViewer file={file} kind={kind} contentUrl={contentUrl} downloadUrl={downloadUrl} onClose={onClose} />;
}

function MediaViewer({ file, kind, contentUrl, downloadUrl, onClose }: {
  file: NextcloudEntry;
  kind: string;
  contentUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current!.showModal();
    return () => {
      dialog.current?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (kind !== "text") return;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(contentUrl, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("Could not load the file.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let result = "", length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("This file is too large to preview as text. You can download it."); }
        result += decoder.decode(value, { stream: true });
      }
      setText(result + decoder.decode());
    })().catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [kind, contentUrl]);
  const mediaError = () => setError("Could not play the file. Try downloading it and opening it on your computer.");
  return <dialog ref={dialog} className="nextcloud-viewer" aria-labelledby="nextcloud-viewer-title" onCancel={onClose}>
    <header className="nextcloud-viewer-toolbar">
      <h2 id="nextcloud-viewer-title">{file.name}</h2>
      <a href={downloadUrl} aria-label={`Download ${file.name}`}><Download size={19} /></a>
      <button type="button" aria-label="Close preview" onClick={onClose}><X size={21} /></button>
    </header>
    <div className="nextcloud-viewer-body">
      {error ? <p role="alert">{error}</p> : <>
        {kind === "video" && <video src={contentUrl} controls preload="metadata" onError={mediaError} aria-label={file.name} />}
        {kind === "audio" && <audio src={contentUrl} controls preload="metadata" onError={mediaError} aria-label={file.name} />}
        {kind === "image" && <img src={contentUrl} alt={file.name} onError={() => setError("Could not load the image.")} />}
        {kind === "text" && (text === null ? <p role="status">Loading file…</p> : <pre>{text}</pre>)}
        {kind === "other" && <p>You can <a href={downloadUrl}>download this file and open it on your computer</a>.</p>}
      </>}
    </div>
  </dialog>;
}
