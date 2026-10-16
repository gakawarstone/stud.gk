const { app, BrowserWindow, shell } = require("electron");
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

async function openTabContextMenu(window, tab) {
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-course-tab="${tab}"]').getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseDown", button: "right", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "right", clickCount: 1, ...point });
  const label = { news: "Ankündigungen", schedule: "Termine", course: "Kursinfo", nextcloud: "Nextcloud" }[tab];
  await waitFor(window, `document.querySelector('button[aria-label="Удалить ${label} из панели"]') !== null`);
}

async function saveNextcloudLink(window, url) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#nextcloud-url');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-form').requestSubmit()`);
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
  await window.webContents.executeJavaScript(`Object.keys(localStorage).filter(key => key.startsWith('stud-gk-course-tabs:')).forEach(key => localStorage.removeItem(key)); localStorage.setItem('campus-smoke-origin', location.origin); document.querySelector('a[href^="#course="]').click()`);
  await waitFor(window, `document.querySelector('.back-to-courses') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-sidebar [aria-current="page"]').getAttribute('aria-label')`), "Dateien");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-course-tab]').length`), 1);
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
  // Course tabs retain their settings and use the same snapshot as the files.
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Ankündigungen"]').click()`);
  await waitFor(window, `document.querySelector('.course-section-title')?.textContent === 'Ankündigungen'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.file-view-switch')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-section-notice').textContent`), "Объявлений пока нет.");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  assert.deepEqual(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[role="menu"] button'), button => button.getAttribute('aria-label'))`), ["Добавить Termine", "Добавить Kursinfo", "Добавить Nextcloud"]);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[role="menuitemcheckbox"]')`), null);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Kursinfo"]').click()`);
  await waitFor(window, `document.querySelector('.course-info') !== null`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.course-info').textContent.includes(${JSON.stringify(demo.courses[0].description)})`));
  assert.equal(await window.webContents.executeJavaScript(`new URLSearchParams(location.hash.slice(1)).get('tab')`), "course");
  await window.webContents.executeJavaScript(`history.back()`);
  await waitFor(window, `document.querySelector('.course-section-title')?.textContent === 'Ankündigungen'`);
  await window.webContents.executeJavaScript(`history.forward()`);
  await waitFor(window, `document.querySelector('.course-info') !== null`);
  window.webContents.reload();
  await waitFor(window, `document.querySelector('.demo-link') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelector('.course-info') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-course-tab]').length`), 3);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[role="menu"] button').length`), 2);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Termine"]').click()`);
  await waitFor(window, `document.querySelectorAll('[data-course-tab]').length === 4 && document.querySelector('[data-course-tab="schedule"]').getAttribute('aria-current') === 'page'`);
  // Mock share data in the renderer; the API's real WebDAV and streaming behavior
  // is covered by server/nextcloud.test.js without a network-dependent smoke test.
  const installNextcloudFixture = () => window.webContents.executeJavaScript(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (String(url) === '/api/nextcloud/list') {
        if (window.nextcloudFixtureError) return new Response(JSON.stringify({ error: 'Share unavailable' }), { status: 403 });
        const path = JSON.parse(options.body).path;
        const file = (name, mime, directory = false) => ({ name, mime, directory, path: path ? path + '/' + name : name, size: 1024, modified: null, etag: 'fixture' });
        return new Response(JSON.stringify({ title: 'Course videos', path, backend: 'dav', entries: path ? [file('notes.txt', 'text/plain')] : [file('Lectures', '', true), file('lecture.mp4', 'video/mp4')] }));
      }
      if (String(url).startsWith('/api/nextcloud/file/preview?') && new URL(String(url), location.origin).searchParams.get('path').endsWith('notes.txt')) {
        return new Response('<script>text, never executable</script>');
      }
      return originalFetch(url, options);
    };
  })()`);
  window.webContents.on('did-finish-load', installNextcloudFixture);
  await installNextcloudFixture();
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Nextcloud"]').click()`);
  await waitFor(window, `document.querySelector('#nextcloud-url') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#nextcloud-url').value`), "");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').disabled`), true);
  await saveNextcloudLink(window, "javascript:alert(1)");
  await waitFor(window, `document.querySelector('.nextcloud-error') !== null`);
  const shareUrl = "https://nextcloud.example.org/nextcloud/index.php/s/share";
  await saveNextcloudLink(window, shareUrl);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-form')`), null);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Открыть папку Lectures"]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Открыть notes.txt"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Открыть notes.txt"]').click()`);
  await waitFor(window, `document.querySelector('.nextcloud-viewer pre') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-viewer pre').textContent`), '<script>text, never executable</script>');
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Закрыть просмотр"]').click()`);
  await waitFor(window, `document.querySelector('dialog') === null`);
  await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-breadcrumbs > button').click()`);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  await window.webContents.executeJavaScript(`window.nextcloudFixtureError = true; document.querySelector('button[aria-label="Обновить файлы Nextcloud"]').click()`);
  await waitFor(window, `document.querySelector('.nextcloud-load-error') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.nextcloud-file').length`), 0);
  await window.webContents.executeJavaScript(`window.nextcloudFixtureError = false; document.querySelector('.nextcloud-load-error button').click()`);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Изменить ссылку Nextcloud"]').click()`);
  const editedUrl = `${shareUrl}#files`;
  await saveNextcloudLink(window, editedUrl);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  const externalUrls = [];
  const originalOpenExternal = shell.openExternal;
  shell.openExternal = async (url) => { externalUrls.push(url); };
  try {
    await window.webContents.executeJavaScript(`document.querySelector('a[aria-label="Открыть Nextcloud в браузере"]').click()`);
    for (let attempt = 0; attempt < 100 && !externalUrls.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(externalUrls, [editedUrl]);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
  } finally { shell.openExternal = originalOpenExternal; }
  window.webContents.reload();
  await waitFor(window, `document.querySelector('.demo-link') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('a[aria-label="Открыть Nextcloud в браузере"]').href`), editedUrl);
  await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#course=${demo.courses[1].id}&tab=nextcloud`)}`);
  await waitFor(window, `document.querySelector('#nextcloud-url')?.value === ''`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.nextcloud-file').length`), 0);
  await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#course=${demo.courses[0].id}&tab=nextcloud`)}`);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Изменить ссылку Nextcloud"]').click()`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#nextcloud-url').value`), editedUrl);
  window.setSize(480, 700);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('#nextcloud-url').getBoundingClientRect().right <= innerWidth`));
  assert.ok(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth <= innerWidth`));
  window.setSize(1280, 850);
  await openTabContextMenu(window, "nextcloud");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Удалить Nextcloud из панели"]').click()`);
  await waitFor(window, `document.querySelector('[data-course-tab="nextcloud"]') === null && document.querySelector('.file-grid') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Nextcloud"]').click()`);
  await waitFor(window, `document.querySelectorAll('.nextcloud-file').length === 2`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('a[aria-label="Открыть Nextcloud в браузере"]').href`), editedUrl);
  await openTabContextMenu(window, "nextcloud");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Удалить Nextcloud из панели"]').click()`);
  await waitFor(window, `document.querySelector('[data-course-tab="nextcloud"]') === null`);
  window.webContents.off('did-finish-load', installNextcloudFixture);
  await window.webContents.executeJavaScript(`document.querySelector('[data-course-tab="schedule"]').click()`);
  await waitFor(window, `document.querySelector('.course-sidebar [aria-current="page"]').dataset.courseTab === 'schedule'`);
  await openTabContextMenu(window, "schedule");
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(window, `document.querySelector('[role="menu"]') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.courseTab`), "schedule");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "F10", modifiers: ["shift"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "F10", modifiers: ["shift"] });
  await waitFor(window, `document.querySelector('button[aria-label="Удалить Termine из панели"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-course-tab="files"]').click()`);
  await waitFor(window, `document.querySelector('.file-grid') !== null && document.querySelector('[role="menu"]') === null`);
  await openTabContextMenu(window, "schedule");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Удалить Termine из панели"]').click()`);
  await waitFor(window, `document.querySelector('[data-course-tab="schedule"]') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-sidebar [aria-current="page"]').dataset.courseTab`), "files");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').disabled`), false);
  await window.webContents.executeJavaScript(`document.querySelector('[data-course-tab="files"]').click()`);
  await waitFor(window, `document.querySelector('.file-grid') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.file-card').length`), 2);
  const news = demo.resources.find((item) => item.kind === "news");
  await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#course=${news.courseId}`)}`);
  await waitFor(window, `document.querySelectorAll('[data-course-tab]').length === 1`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-sidebar [aria-current="page"]').getAttribute('aria-label')`), "Dateien");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Ankündigungen"]').click()`);
  await waitFor(window, `document.querySelector('.course-news h3') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-news h3').textContent`), news.title);
  await window.webContents.executeJavaScript(`document.querySelector('.course-news summary').click()`);
  await waitFor(window, `document.querySelector('.course-news[open]') !== null && document.querySelector('.course-rail-dot') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-resource-body').textContent`), news.description);
  window.setSize(480, 700);
  await openTabContextMenu(window, "news");
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[role="menu"]').getBoundingClientRect().right <= innerWidth`));
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(window, `document.querySelector('[role="menu"]') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.courseTab`), "news");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[role="menu"]').getBoundingClientRect().right <= innerWidth`));
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(window, `document.querySelector('[role="menu"]') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.getAttribute('aria-label')`), "Добавить вкладку");
  window.setSize(1280, 850);
  if (process.env.CAMPUS_SMOKE_SIDEBAR_SCREENSHOT) {
    await writeFile(process.env.CAMPUS_SMOKE_SIDEBAR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  await openTabContextMenu(window, "news");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Удалить Ankündigungen из панели"]').click()`);
  await waitFor(window, `document.querySelectorAll('[data-course-tab]').length === 1 && document.querySelector('.file-grid') !== null`);
  window.webContents.reload();
  await waitFor(window, `document.querySelector('.demo-link') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelectorAll('[data-course-tab]').length === 1 && document.querySelector('.file-grid') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Ankündigungen"]') !== null`));
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(window, `document.querySelector('[role="menu"]') === null`);
  const event = demo.resources.find((item) => item.kind === "schedule");
  await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#course=${event.courseId}`)}`);
  await waitFor(window, `document.querySelector('.course-heading').textContent === ${JSON.stringify(demo.courses.find((course) => course.id === event.courseId).title)}`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await waitFor(window, `document.querySelector('[role="menu"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить Termine"]').click()`);
  await waitFor(window, `document.querySelector('.course-event') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.course-event h3').textContent`), event.title);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.course-event').textContent.includes(${JSON.stringify(event.location)})`));
  await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(`#course=${demo.courses[0].id}`)}`);
  await waitFor(window, `document.querySelector('.file-grid') !== null && document.querySelectorAll('[data-course-tab]').length === 3`);
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
