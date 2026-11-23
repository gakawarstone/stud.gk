const { app } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
app.commandLine.appendSwitch("force-device-scale-factor", "2");
const timeout = setTimeout(() => { console.error("Google Drive smoke timed out"); app.exit(1); }, 60000);
async function waitFor(window, expression) {
  for (let i = 0; i < 200; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}
(async () => {
  app.setPath("appData", await mkdtemp(path.join(os.tmpdir(), "drive-smoke-")));
  const { window, runtime } = await require("../electron/main.cjs").ready;
  await waitFor(window, "document.querySelector('.demo-link')");
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelector('a[href^="#course="]')`);
  await window.webContents.executeJavaScript(`document.querySelector('a[href^="#course="]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Add tab"]')`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Add tab"]').click(); document.querySelector('button[aria-label="Add Google Drive"]').click()`);
  await waitFor(window, `document.querySelector('#google-drive-url')`);
  await window.webContents.executeJavaScript(`(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (url, options) => {
      if (url === '/api/google-drive/list') {
        const parent = JSON.parse(options.body).url;
        const data = parent.includes('childfolder123') ? [] : [
          { id:'childfolder123', path:'childfolder123', name:'Exercises', directory:true, mime:'', size:0, modified:null, etag:'1', resourceKey:'' },
          { id:'textdocument123', path:'textdocument123', name:'Course notes.txt', directory:false, mime:'text/plain', size:0, modified:null, etag:'1', resourceKey:'' }
        ];
        return Promise.resolve(new Response(JSON.stringify({ entries: data }), { headers: { 'content-type': 'application/json' } }));
      }
      if (String(url).startsWith('/api/google-drive/file/preview')) return Promise.resolve(new Response('Example course notes'));
      return fetchOriginal(url, options);
    };
    const input = document.querySelector('#google-drive-url');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://drive.google.com/drive/folders/examplefolder123');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  if (process.env.DRIVE_SCREENSHOTS) await writeFile(path.join(process.env.DRIVE_SCREENSHOTS, 'google-drive-link.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-form').requestSubmit()`);
  await waitFor(window, `document.querySelector('button[aria-label="Open folder Exercises"]') && document.querySelector('button[aria-label="Google Drive settings"]')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-breadcrumbs')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-section .nextcloud-actions')`), null);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  if (process.env.DRIVE_SCREENSHOTS) await writeFile(path.join(process.env.DRIVE_SCREENSHOTS, 'google-drive-folder.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Google Drive settings"]').click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Refresh Google Drive files"]')`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Edit Google Drive link"]') && document.querySelector('a[aria-label="Open Google Drive in browser"]')`));
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); document.querySelector('button[aria-label="Open Course notes.txt"]').click()`);
  await waitFor(window, `document.querySelector('.nextcloud-viewer pre')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.nextcloud-viewer pre').textContent`), 'Example course notes');
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('a[aria-label="Download Course notes.txt"]').getAttribute('href').includes('/api/google-drive/file/download')`));
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close preview"]').click(); document.querySelector('button[aria-label="Open folder Exercises"]').click()`);
  await waitFor(window, `document.querySelector('.nextcloud-breadcrumbs') && document.querySelector('.course-section-notice')?.textContent.includes('No files')`);
  console.log('Google Drive UI smoke passed');
  clearTimeout(timeout); await runtime.close(); app.exit(0);
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
