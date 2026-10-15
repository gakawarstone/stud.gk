const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, readFile, stat } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const timer = setTimeout(() => {
  console.error("Desktop smoke test timed out");
  app.exit(1);
}, 30000);

async function waitFor(window, expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

(async () => {
  // Never use or alter the developer's Stud.GK profile in a smoke test.
  const profile = process.env.CAMPUS_SMOKE_PROFILE || await mkdtemp(path.join(os.tmpdir(), "campus-smoke-"));
  app.setPath("appData", profile);
  const entry = process.env.CAMPUS_SMOKE_ENTRY || path.resolve(__dirname, "../electron/main.cjs");
  const { window, runtime } = await require(entry).ready;
  assert.equal(runtime.host, "127.0.0.1");
  const failures = [];
  window.webContents.on("render-process-gone", (_, details) => failures.push(details.reason));
  await waitFor(window, `document.querySelector('.demo-link') !== null`);
  assert.equal(await window.webContents.executeJavaScript("typeof require"), "undefined");
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  const auth = await fetch(`${runtime.url}/api/state`).then((response) => response.json());
  assert.equal(auth.authenticated, false);
  const demo = await fetch(`${runtime.url}/api/demo`).then((response) => response.json());
  assert.ok(demo.courses.length > 0);
  for (const asset of ["/pdf-assets/cmaps/Adobe-Japan1-UCS2.bcmap", "/pdf-assets/standard_fonts/LiberationSans-Regular.ttf", "/pdf-assets/wasm/openjpeg.wasm"]) {
    const response = await fetch(`${runtime.url}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.doesNotMatch(response.headers.get("content-type"), /text\/html/, asset);
  }
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelectorAll('a[href^="#course="]').length > 0`);
  const courseCount = await window.webContents.executeJavaScript(`document.querySelectorAll('a[href^="#course="]').length`);
  assert.equal(courseCount, demo.courses.length);
  const persisted = await window.webContents.executeJavaScript(`localStorage.getItem('campus-smoke-origin')`);
  if (process.env.CAMPUS_SMOKE_RESTART === "1") assert.equal(persisted, runtime.url);
  await window.webContents.executeJavaScript(`localStorage.setItem('campus-smoke-origin', location.origin); document.querySelector('a[href^="#course="]').click()`);
  await waitFor(window, `document.querySelector('.back-to-courses') !== null`);
  // The folder mode uses real hierarchy data and survives a renderer reload.
  await window.webContents.executeJavaScript(`document.querySelectorAll('.file-view-switch button')[1].click()`);
  await waitFor(window, `document.querySelector('.folder-explorer-sidebar') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Открыть папку Übungen"]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Открыть папку Projekt"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Свернуть папку Übungen"]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Открыть папку Projekt"]') === null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Развернуть папку Übungen"]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Открыть папку Projekt"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Открыть папку Projekt"]').click()`);
  await waitFor(window, `document.querySelectorAll('.file-card').length === 1`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.explorer-file-icon').length`), 1);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.file-preview').length`), 0);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Открыть папку Vorlesungen"]') !== null`));
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.folder-explorer-sidebar [aria-current="page"]').textContent`), "Projekt");
  window.webContents.reload();
  await waitFor(window, `document.querySelector('.demo-link') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelectorAll('.file-card').length === 1 && document.querySelector('.folder-explorer-sidebar [aria-current="page"]')?.textContent === 'Projekt'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.file-view-switch button')[1].getAttribute('aria-pressed')`), "true");
  await window.webContents.executeJavaScript(`document.querySelectorAll('.file-view-switch button')[0].click()`);
  await waitFor(window, `document.querySelectorAll('.file-card').length === 2`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.folder-explorer-sidebar')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.file-preview').length`), 2);
  // Same-origin preview windows must share authentication and remain sandboxed.
  const previewReady = new Promise((resolve) => app.once("browser-window-created", (_, child) => {
    child.webContents.once("did-finish-load", () => resolve(child));
  }));
  await window.webContents.executeJavaScript(`window.open('/api/demo', '_blank')`);
  const preview = await previewReady;
  assert.equal(preview.webContents.session, window.webContents.session);
  assert.equal(preview.webContents.getLastWebPreferences().sandbox, true);
  preview.close();
  // A non-web protocol must never create a window or reach the OS shell.
  await window.webContents.executeJavaScript(`window.open('file:///etc/passwd', '_blank')`);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  const dataDir = path.join(app.getPath("userData"), "data");
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(dataDir, "session.key"))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path.join(app.getPath("userData"), "desktop-port.json"))).port, runtime.port);
  assert.deepEqual(failures, []);
  if (process.env.CAMPUS_SMOKE_SCREENSHOT) {
    await writeFile(process.env.CAMPUS_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  console.log(JSON.stringify({ result: "passed", entry, url: runtime.url, courseCount, electron: process.versions.electron, profile }));
  clearTimeout(timer);
  app.quit();
})().catch((error) => {
  console.error(error);
  clearTimeout(timer);
  app.exit(1);
});
