const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let runtime, profile;
const timeout = setTimeout(() => { console.error("Session smoke timed out"); app.exit(1); }, 30000);
async function waitFor(window, expression) {
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function login(window) {
  await window.webContents.executeJavaScript(`(() => {
    for (const name of ['username', 'password']) {
      const input = document.getElementById(name);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fixture');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('.login-card form').requestSubmit()`);
  await waitFor(window, `document.querySelector('.account-button') !== null && window.fixture.timers.size === 1`);
}

(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-session-"));
  app.setPath("userData", profile);
  await app.whenReady();
  const root = path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  runtime = await startServer({ dataDir: path.join(profile, "data"), autoSync: false });
  const window = new BrowserWindow({ show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await window.loadURL(runtime.url);
  await waitFor(window, `document.getElementById('username') !== null`);
  await window.webContents.executeJavaScript(`(async () => {
    const originalFetch = window.fetch.bind(window);
    const demo = await (await originalFetch('/api/demo')).json();
    const originalTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const fixture = window.fixture = {
      live: {...demo, authenticated:true, mode:'live', syncing:true, user:{id:'fixture', name:'Fixture'}},
      timers:new Map(), nextTimer:1000000, stateCalls:0, pending:[],
    };
    const json = (value) => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 2000 && delay !== 30000) return originalTimeout(callback, delay, ...args);
      const id = fixture.nextTimer++;
      fixture.timers.set(id, {callback, delay});
      return id;
    };
    window.clearTimeout = (id) => {
      if (!fixture.timers.delete(id)) originalClearTimeout(id);
    };
    fixture.poll = () => {
      const [id, timer] = [...fixture.timers][0];
      fixture.timers.delete(id);
      void timer.callback();
    };
    fixture.resolve = (index, value) => fixture.pending[index](json(value));
    window.fetch = (url, options) => {
      if (url === '/api/auth/login') { fixture.immediateState = true; return Promise.resolve(json({ok:true})); }
      if (url === '/api/auth/logout') return new Promise((resolve) => { fixture.logout = () => resolve(json({ok:true})); });
      if (url === '/api/state') {
        fixture.stateCalls++;
        if (fixture.immediateState) { fixture.immediateState = false; return Promise.resolve(json(fixture.live)); }
        // Deliberately ignore AbortSignal to exercise stale-response guards too.
        return new Promise((resolve) => fixture.pending.push(resolve));
      }
      return originalFetch(url, options);
    };
  })()`);
  await login(window);
  assert.equal(await window.webContents.executeJavaScript(`[...fixture.timers.values()][0].delay`), 2000);
  await window.webContents.executeJavaScript(`fixture.poll()`);
  await waitFor(window, `fixture.pending.length === 1`);
  assert.equal(await window.webContents.executeJavaScript(`fixture.timers.size`), 0);
  assert.equal(await window.webContents.executeJavaScript(`fixture.stateCalls`), 2);
  // Resolving a slow poll schedules exactly one subsequent poll.
  await window.webContents.executeJavaScript(`fixture.resolve(0, {...fixture.live, syncing:false})`);
  await waitFor(window, `fixture.timers.size === 1 && [...fixture.timers.values()][0].delay === 30000`);
  assert.equal(await window.webContents.executeJavaScript(`fixture.stateCalls`), 2);
  await window.webContents.executeJavaScript(`fixture.poll()`);
  await waitFor(window, `fixture.pending.length === 2`);
  await window.webContents.executeJavaScript(`document.querySelector('.account-button').click()`);
  await waitFor(window, `typeof fixture.logout === 'function'`);
  await window.webContents.executeJavaScript(`fixture.logout()`);
  await waitFor(window, `document.getElementById('username') !== null`);
  await window.webContents.executeJavaScript(`fixture.resolve(1, fixture.live)`);
  await waitFor(window, `fixture.timers.size === 0`);
  assert.equal(await window.webContents.executeJavaScript(`!!document.getElementById('username')`), true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.account-button')`), null);

  await login(window);
  await window.webContents.executeJavaScript(`document.querySelector('.course-card-link').click()`);
  await waitFor(window, `location.hash.includes('course=')`);
  await window.webContents.executeJavaScript(`fixture.poll()`);
  await waitFor(window, `fixture.pending.length === 3`);
  await window.webContents.executeJavaScript(`fixture.resolve(2, {authenticated:false, authExpired:true})`);
  await waitFor(window, `document.getElementById('username') !== null && fixture.timers.size === 0`);
  assert.equal(await window.webContents.executeJavaScript(`location.hash`), "");
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.form-error').textContent`), /Your session has expired/);
  await window.webContents.executeJavaScript(`document.querySelector('.demo-link').click()`);
  await waitFor(window, `document.querySelector('.demo-badge') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`fixture.timers.size`), 0);
  console.log(JSON.stringify({ result: "passed", scenarios: ["slow polling", "late response after logout", "session expiry", "demo"] }));
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
