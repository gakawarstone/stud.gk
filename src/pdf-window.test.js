import assert from "node:assert/strict";
import test from "node:test";
import { pdfWindowUrl, readPdfWindowState } from "./pdf-window.ts";

const origin = "http://127.0.0.1:3000";
const state = {
  title: "Lecture #2 & Übungen.pdf",
  contentUrl: "/api/files/lecture/preview",
  downloadUrl: "/api/files/lecture/download",
  page: 7, fraction: 0.25, zoom: 1.4, themed: false,
};
const read = (value) => readPdfWindowState(new URL(pdfWindowUrl(value), origin).hash, origin);

test("PDF window links preserve filenames, source queries and reading state", () => {
  for (const contentUrl of [
    state.contentUrl,
    "/api/gitlab/courses/c1/projects/p1/content?path=folder%2Fa.pdf&ref=feature%2Fpdf",
    "/api/nextcloud/file/preview?share=https%3A%2F%2Fcloud.example%2Fs%2Fshare&path=a%20b.pdf",
  ]) assert.deepEqual(read({ ...state, contentUrl }), { ...state, contentUrl });
});

test("PDF window links reject external URLs, non-API URLs and invalid view state", () => {
  for (const key of ["contentUrl", "downloadUrl"]) {
    for (const url of ["https://example.org/api/file", "//example.org/api/file", "javascript:alert(1)", "file:///etc/passwd", "/settings", "/api/../settings", "http://user:pass@127.0.0.1:3000/api/file"])
      assert.equal(read({ ...state, [key]: url }), null);
  }
  for (const patch of [{ page: 0 }, { page: 1.5 }, { zoom: 10 }, { fraction: -1 }, { themed: "true" }, { title: null }])
    assert.equal(read({ ...state, ...patch }), null);
  for (const hash of ["", "#course=c1", "#pdf=garbage", "#pdf=null"])
    assert.equal(readPdfWindowState(hash, origin), null);
});
