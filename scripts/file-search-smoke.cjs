const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.on("window-all-closed", () => {});
let runtime, profile;
const timeout = setTimeout(() => {
  console.error("File search smoke timed out");
  app.exit(1);
}, 60000);
async function evaluate(window, code) {
  return window.webContents.executeJavaScript(code);
}
async function waitFor(window, condition) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(window, condition)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.error(await evaluate(window, `({ cards: document.querySelectorAll('.file-card').length,
    thumbnails: document.querySelectorAll('.file-thumbnail').length,
    fallback: document.querySelector('.thumbnail-fallback')?.textContent,
    viewport: [innerWidth, innerHeight], text: document.body.innerText.slice(0, 1000) })`));
  throw new Error(`Timed out: ${condition}`);
}
async function search(window, query) {
  await evaluate(window, `(() => {
    const input = document.querySelector('.file-search input');
    input.value = ${JSON.stringify(query)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function press(window, keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await evaluate(window, "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
}
async function screenshot(window, name) {
  if (!process.env.CAMPUS_SEARCH_SCREENSHOTS) return;
  window.webContents.sendInputEvent({ type: "mouseMove", x: 95, y: 28 });
  await evaluate(window, "document.fonts.ready");
  await evaluate(window, "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  await evaluate(window, `Promise.all(document.getAnimations()
    .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {})))`);
  await mkdir(process.env.CAMPUS_SEARCH_SCREENSHOTS, { recursive: true });
  await writeFile(path.join(process.env.CAMPUS_SEARCH_SCREENSHOTS, `${name}.png`), (await window.capturePage()).toPNG());
}

// A real PDF cover so screenshots exercise the same thumbnail path as course materials.
function pdfCover(title, subtitle) {
  const escape = (text) => text.replace(/[()\\]/g, "\\$&");
  const stream = [
    "0.12 0.12 0.18 rg 0 0 612 792 re f",
    "0.98 0.70 0.53 rg",
    `BT /F1 30 Tf 46 495 Td (${escape(title)}) Tj ET`,
    "0.80 0.84 0.96 rg",
    `BT /F1 16 Tf 46 450 Td (${escape(subtitle)}) Tj ET`,
    "0.54 0.86 0.92 rg",
    "BT /F1 14 Tf 46 355 Td (Web- und Mobile Entwicklung) Tj ET",
    "0.50 0.52 0.61 rg",
    "BT /F1 13 Tf 46 330 Td (WS 2026/27) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  return Buffer.from(`${pdf}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-search-"));
  app.setPath("userData", profile);
  await app.whenReady();
  const root = process.env.CAMPUS_SMOKE_ROOT || path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  const { CookieJar } = await import("tough-cookie");
  const titles = [
    ["04_aufgabe_serialization.pdf", "Serialization & JSON APIs", "Aufgabe 4: REST-API und Ktor-Client"],
    ["04_serialization.pdf", "Serialization & JSON APIs", "Vom HTML-Server zur REST-API"],
    ["kapitel_04_serialization.pdf", "Kapitel 4: Serialization", "JSON, Serializer und REST-APIs"],
    ["03_ktor_slides.pdf", "Ktor", "Vom ersten Request zur Web-Anwendung"],
    ["03_ktor.pdf", "Ktor", "Vom ersten Request zur Web-Anwendung"],
    ["kapitel_03_ktor.pdf", "Kapitel 3: Ktor", "Server, Routing und Plugins"],
    ["03_aufgabe_ktor_server.pdf", "Aufgabe 3: Ktor Server", "Routing, Formulare und Tests"],
    ["02_aufgabe_reactive_programmierung.pdf", "Reactive Programmierung", "Aufgabe 2: CSV-Import und Live-Statistik"],
    ["02_reactive_programmierung.pdf", "Reactive Programmierung", "Von Sequences zu Coroutines zu Flows"],
    ["kapitel_02_reactive_programmierung.pdf", "Kapitel 2: Reactive", "Sequences, Coroutines und Flows"],
    ["01_aufgabe_kotlin_grundlagen.pdf", "Kotlin Grundlagen", "Aufgabe 1: Datenmodelle"],
    ["01_kotlin_grundlagen.pdf", "Kotlin Grundlagen", "Eine moderne Cross-Platform-Sprache"],
  ];
  const resources = titles.map(([title], index) => ({
    id: `file-${index}`, remoteId: `file-${index}`, courseId: "web", kind: "file", title,
    createdAt: `2026-10-${index < 3 ? "28" : index < 7 ? "21" : "14"}T12:00:00Z`,
  }));
  runtime = await startServer({
    root, dataDir: path.join(profile, "data"), autoSync: false,
    authenticate: async () => ({ jar: new CookieJar(), user: { id: "fixture", name: "Jamie Parker" } }),
    getSnapshot: async () => ({
      courses: [
        { id: "web", title: "Web-/Mobile-Technologien (WPF AI-5)", color: "mauve" },
        { id: "algo", title: "Algorithms & data structures", color: "blue" },
      ],
      resources: [...resources, { ...resources[0], id: "other", remoteId: "other", courseId: "algo" }],
    }),
    getFolders: async () => ({
      rootId: "root",
      folders: [
        { id: "root", parentId: null, title: "Course files", readable: true },
        { id: "lectures", parentId: "root", title: "Lectures", readable: true },
        { id: "exercises", parentId: "root", title: "Exercises", readable: true },
      ],
      fileFolders: resources.map((file) => ({ fileRefId: file.remoteId, folderId: file.title.includes("aufgabe") ? "exercises" : "lectures" })),
    }),
    getDownload: async (_jar, file) => {
      const [, title, subtitle] = titles[Number(file.remoteId.replace("file-", ""))] || titles[0];
      const pdf = pdfCover(title, subtitle);
      return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Length": String(pdf.length) } });
    },
  });
  const window = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const errors = require("./renderer-errors.cjs")(window);
  await window.loadURL(runtime.url);
  await waitFor(window, "!!document.querySelector('#username')");
  assert.equal(await evaluate(window, "document.querySelector('.file-search')"), null);
  await evaluate(window, `(() => {
    for (const id of ['username', 'password']) {
      const input = document.getElementById(id); input.value = 'fixture';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('form').requestSubmit();
  })()`);
  await waitFor(window, "document.querySelectorAll('.course-card').length === 2");
  assert.equal(await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))`), true, "Home leaves browser find available");
  await evaluate(window, "location.hash = 'course=web'");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 12");
  await waitFor(window, "document.querySelectorAll('.file-thumbnail').length >= 8 && [...document.querySelectorAll('.file-thumbnail')].every(image => image.complete)");
  await screenshot(window, "all-files");
  await press(window, "f", ["control"]);
  assert.equal(await evaluate(window, "document.activeElement === document.querySelector('.file-search input')"), true);
  assert.equal(await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`), true, "Other shortcuts remain available");
  await search(window, "  KTOR  ");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 4");
  assert.equal(await evaluate(window, "document.querySelector('#file-search-results').textContent.includes('4 of 12 files')"), true);
  await press(window, "f", ["control"]);
  assert.deepEqual(await evaluate(window, "[document.activeElement.selectionStart, document.activeElement.selectionEnd]"), [0, 8]);
  await search(window, "ktor");
  await waitFor(window, "document.querySelectorAll('.file-thumbnail').length === 4 && [...document.querySelectorAll('.file-thumbnail')].every(image => image.complete)");
  await screenshot(window, "search-results");
  await press(window, "Escape");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 12");
  await search(window, "no-such-file");
  await waitFor(window, "document.querySelector('.empty h2')?.textContent === 'No matching files'");
  await screenshot(window, "no-results");
  await evaluate(window, "document.querySelector('.empty-link').click()");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 12");
  await search(window, "serialization");
  await evaluate(window, "document.querySelector('button[aria-label=\"Clear search\"]').click()");
  assert.equal(await evaluate(window, "document.activeElement === document.querySelector('.file-search input') && document.activeElement.value === ''"), true);
  // A PDF keeps its own keyboard handling, and closing it preserves the filter.
  await search(window, "serialization");
  await evaluate(window, "document.querySelector('.file-card button').click()");
  await waitFor(window, "!!document.querySelector('dialog[open] .pdf-page canvas')");
  assert.equal(await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))`), true, "PDF dialog does not redirect find to the background search");
  await press(window, "Escape");
  await waitFor(window, "!document.querySelector('dialog[open]')");
  assert.equal(await evaluate(window, "document.querySelector('.file-search input').value"), "serialization");
  // Folder search is explicit about its scope and resets on folder navigation.
  await evaluate(window, "document.querySelector('button[aria-label=\"Folders\"]').click()");
  await waitFor(window, "!!document.querySelector('.folder-explorer-sidebar')");
  await evaluate(window, "document.querySelector('button[aria-label=\"Open folder Lectures\"]').click()");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 8");
  assert.equal(await evaluate(window, "document.querySelector('.file-search input').placeholder"), "Search this folder…");
  await search(window, "ktor");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 3");
  assert.equal(await evaluate(window, "document.querySelector('.folder-explorer-sidebar [aria-current=\"page\"]').textContent"), "Lectures");
  await screenshot(window, "folder-results");
  await evaluate(window, "document.querySelector('button[aria-label=\"Open folder Exercises\"]').click()");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 4 && document.querySelector('.file-search input').value === ''");
  await search(window, "ktor");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 1");
  await evaluate(window, "document.querySelector('button[aria-label=\"All files\"]').click()");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 12 && document.querySelector('.file-search input').value === ''");
  // The whole control remains usable on a narrow screen.
  window.setSize(480, 850);
  await search(window, "ktor");
  await press(window, "f", ["control"]);
  await waitFor(window, "document.querySelectorAll('.file-thumbnail').length === 4 && [...document.querySelectorAll('.file-thumbnail')].every(image => image.complete)");
  assert.equal(await evaluate(window, `(() => {
    const input = document.querySelector('.file-search input').getBoundingClientRect();
    const tools = document.querySelector('.course-file-tools').getBoundingClientRect();
    return input.width > 100 && tools.left >= 0 && tools.right <= innerWidth && document.documentElement.scrollWidth === innerWidth;
  })()`), true, "Narrow header has no horizontal overflow");
  await screenshot(window, "narrow-results");
  await search(window, "serialization");
  await evaluate(window, "location.hash = 'course=algo'");
  await waitFor(window, "document.querySelectorAll('.file-card').length === 1 && document.querySelector('.file-search input').value === ''");
  await search(window, "missing");
  await evaluate(window, "document.querySelector('button[aria-label=\"Add tab\"]').click()");
  await evaluate(window, "document.querySelector('button[aria-label=\"Add Announcements\"]').click()");
  await waitFor(window, "!!document.querySelector('.course-section-news')");
  assert.equal(await evaluate(window, "document.querySelector('.file-search')"), null);
  assert.equal(await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))`), true, "Other tabs leave browser find available");
  await evaluate(window, "document.querySelector('button[aria-label=\"Files\"]').click()");
  await waitFor(window, "!!document.querySelector('.file-search input')");
  assert.equal(await evaluate(window, "document.querySelector('.file-search input').value"), "");
  assert.equal(await evaluate(window, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))`), false, "Cmd+F also focuses file search");
  assert.equal(await evaluate(window, "document.activeElement === document.querySelector('.file-search input')"), true);
  await search(window, "missing");
  await evaluate(window, "document.querySelector('.account-button').click()");
  await waitFor(window, "!!document.querySelector('#username')");
  assert.equal(await evaluate(window, "document.querySelector('.file-search')"), null);
  assert.deepEqual(errors, [], "No uncaught UI exceptions");
  console.log(JSON.stringify({ result: "passed", checks: "Ctrl/Cmd+F focus and selection, case-insensitive trimmed filename search, result counts, Escape and clear, no results, PDF dialog scope, folder scope, view/course/tab/session reset, narrow layout" }));
  window.destroy();
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(timeout);
  app.quit();
})().catch(async (error) => {
  console.error(error);
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await runtime?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  app.exit(1);
});
