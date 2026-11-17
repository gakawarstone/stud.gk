import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { googleDriveFolderId, googleDriveRoutes } from "./google-drive.js";

const folder = "https://drive.google.com/drive/folders/1plALaGj69e9ELtaRaYteetmuOypoi5hF?resourcekey=key-123";
async function serve(request, fn) {
  const app = express(); app.use(express.json(), googleDriveRoutes(request));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test("Google Drive links accept only HTTPS Drive folder URLs", () => {
  assert.equal(googleDriveFolderId(folder), "1plALaGj69e9ELtaRaYteetmuOypoi5hF");
  for (const url of ["https://evil.example/drive/folders/1234567890", "https://drive.google.com:444/drive/folders/1234567890", "http://drive.google.com/drive/folders/1234567890", "https://drive.google.com/file/d/1234567890/view"]) assert.equal(googleDriveFolderId(url), null);
});
test("Google Drive folder listing and ranged file streaming use fixed Google hosts", async () => {
  const calls = [];
  await serve(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("embeddedfolderview")) return new Response('<title>Shared</title><div class="flip-entries"><div class="flip-entry" id="entry-abcdefghijk"><a href="https://drive.google.com/drive/folders/abcdefghijk?resourcekey=folder-key"><div class="flip-entry-title">Folder &amp; more</div></a></div><div class="flip-entry" id="entry-0123456789A"><a href="https://drive.google.com/file/d/0123456789A/view"><div class="flip-entry-title">lecture.pdf</div></a></div></div>');
    return new Response("%PDF", { status: 206, headers: { "content-type": "application/octet-stream", "content-range": "bytes 0-3/20", "accept-ranges": "bytes", "content-length": "4", "set-cookie": "private=value" } });
  }, async base => {
    let response = await fetch(`${base}/list`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: folder }) });
    const listing = await response.json();
    assert.equal(listing.entries[0].resourceKey, "folder-key");
    assert.equal(listing.entries[0].name, "Folder & more");
    assert.equal(listing.entries[1].name, "lecture.pdf");
    assert.match(calls[0].url, /^https:\/\/drive\.google\.com\/embeddedfolderview\?/);
    assert.equal(new URL(calls[0].url).searchParams.get("resourcekey"), "key-123");
    response = await fetch(`${base}/file/preview?id=0123456789A&name=lecture.pdf`, { headers: { range: "bytes=0-3" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-range"), "bytes 0-3/20");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(await response.text(), "%PDF");
    assert.match(calls[1].url, /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
    assert.equal(calls[1].options.headers.Range, "bytes=0-3");
    assert.equal(calls[1].options.redirect, "error");
    assert.equal((await fetch(`${base}/file/download?id=bad&name=test`)).status, 400);
    assert.equal((await fetch(`${base}/file/preview?id=0123456789A&name=test`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  });
});
test("Google Drive does not serve HTML error pages as files", async () => {
  await serve(async () => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }), async base => {
    const response = await fetch(`${base}/file/preview?id=0123456789A&name=lecture.pdf`);
    assert.equal(response.status, 502);
  });
});
