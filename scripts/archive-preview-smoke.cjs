const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { readFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
let runtime, profile;
const timeout = setTimeout(() => { console.error('Archive smoke timed out'); app.exit(1); }, 60000);
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
async function waitFor(window, code) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(window, code)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${code}`);
}
async function screenshot(window, name) {
  if (!process.env.CAMPUS_ARCHIVE_SCREENSHOTS) return;
  await evaluate(window, 'document.fonts.ready');
  await evaluate(window, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await mkdir(process.env.CAMPUS_ARCHIVE_SCREENSHOTS, { recursive: true });
  await writeFile(path.join(process.env.CAMPUS_ARCHIVE_SCREENSHOTS, name + '.png'), (await window.capturePage()).toPNG());
}
(async () => {
  profile = await mkdtemp(path.join(tmpdir(), 'stud-gk-archive-'));
  app.setPath('userData', profile);
  await app.whenReady();
  const root = path.resolve(__dirname, '..');
  const { startServer } = await import(pathToFileURL(path.join(root, 'server/runtime.js')).href);
  const { CookieJar } = await import('tough-cookie');
  const zip = await readFile(path.join(root, 'scripts/fixtures/archive-preview.zip'));
  const files = ['Demos_V3.zip', 'Exercises.zip', 'Broken.zip', 'Sources.7z'];
  runtime = await startServer({ root, dataDir: path.join(profile, 'data'), autoSync: false,
    authenticate: async () => ({ jar: new CookieJar(), user: { id: 'fixture', name: 'Jamie Parker' } }),
    getSnapshot: async () => ({ courses: [{ id: 'web', title: 'Web-/Mobile-Technologien (WPF AI-5)', color: 'mauve' }], resources: files.map((title, i) => ({ id: `file-${i}`, remoteId: `file-${i}`, courseId: 'web', kind: 'file', title, createdAt: '2026-10-19T12:00:00Z' })) }),
    getDownload: async (_client, file) => new Response(file.title === 'Broken.zip' ? Buffer.from('invalid') : zip, { headers: { 'Content-Type': 'application/zip' } }),
  });
  const window = new BrowserWindow({ show: true, width: 1280, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const errors = require('./renderer-errors.cjs')(window);
  window.setSize(1280, 900);
  await window.loadURL(runtime.url);
  window.setSize(1280, 900);
  await waitFor(window, 'innerWidth === 1280');
  await waitFor(window, "!!document.querySelector('#username')");
  await evaluate(window, `(() => { for (const id of ['username','password']) { const input = document.getElementById(id); input.value='fixture'; input.dispatchEvent(new Event('input',{bubbles:true})); } document.querySelector('form').requestSubmit(); })()`);
  await waitFor(window, "document.querySelectorAll('.course-card').length === 1");
  await evaluate(window, "location.hash = 'course=web'");
  await waitFor(window, "document.querySelectorAll('.archive-preview-entry').length === 10 && !!document.querySelector('.thumbnail-fallback')");
  assert.equal(await evaluate(window, "document.querySelectorAll('.archive-preview-count')[0].textContent"), '9 entries · +4 more');
  assert.match(await evaluate(window, "document.querySelector('.thumbnail-fallback').textContent"), /Cannot preview/);
  assert.equal(await evaluate(window, "[...document.querySelectorAll('.file-type')].some(el => el.textContent === '7Z')"), true);
  assert.equal(await evaluate(window, `(() => { const rows = [...document.querySelectorAll('.archive-preview-entries')][0]; return rows.scrollHeight <= rows.clientHeight; })()`), true, 'All five listed names fit in the card');
  await screenshot(window, 'cards');
  window.setSize(480, 850);
  await waitFor(window, 'innerWidth === 480');
  assert.equal(await evaluate(window, 'document.documentElement.scrollWidth === innerWidth'), true);
  await screenshot(window, 'narrow');
  window.setSize(1100, 850);
  // Follow the same URL that the card opens in a separate tab.
  const href = await evaluate(window, "document.querySelector('.file-card-link[aria-label=\"Open Demos_V3.zip\"]').href");
  await window.loadURL(href);
  await waitFor(window, "document.querySelectorAll('tbody tr').length === 9");
  assert.match(await evaluate(window, "document.querySelector('h1').textContent"), /Demos_V3.zip/);
  assert.equal(await evaluate(window, "document.querySelector('a').textContent"), 'Download ZIP');
  await screenshot(window, 'contents');
  window.setSize(480, 850);
  await waitFor(window, 'innerWidth === 480');
  assert.equal(await evaluate(window, 'document.documentElement.scrollWidth === innerWidth'), true);
  await screenshot(window, 'contents-narrow');
  assert.deepEqual(errors, []);
  console.log('Archive smoke passed: card metadata, errors, unsupported formats, full listing, download link, narrow layouts, no renderer errors');
  window.destroy();
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(timeout); app.quit();
})().catch(async error => {
  console.error(error); clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await runtime?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  app.exit(1);
});
