import path from "node:path";

const previewTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "video/ogg",
]);
export function previewType(file, response) {
  for (const value of [file.mime, response.headers.get("content-type")]) {
    const type = value?.split(";")[0].trim().toLowerCase();
    if (previewTypes.has(type)) return type;
    if (
      type?.startsWith("text/") ||
      type === "image/svg+xml" ||
      type === "application/json"
    )
      return "text/plain";
  }
  const extensions = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".csv": "text/plain",
    ".json": "text/plain",
    ".html": "text/plain",
    ".htm": "text/plain",
    ".svg": "text/plain",
    ".js": "text/plain",
    ".css": "text/plain",
  };
  return extensions[path.extname(file.title).toLowerCase()] || null;
}
