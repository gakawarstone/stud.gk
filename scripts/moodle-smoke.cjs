const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
app.on("window-all-closed", () => {});
let runtime, directory, window;
const deadline = setTimeout(() => { console.error("Moodle UI timed out"); app.exit(1); }, 60000);
async function evaluate(code) { return window.webContents.executeJavaScript(code); }
async function waitFor(code) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(code)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Timed out: ${code}`);
}
(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "moodle-ui-"));
  app.setPath("userData", path.join(directory, "profile"));
  await app.whenReady();
  const root = path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  const { CookieJar } = await import("tough-cookie");
  const { moodleDemo } = await import(pathToFileURL(path.join(root, "shared/moodle.js")).href);
  runtime = await startServer({ dataDir: path.join(directory, "data"), autoSync: false,
    authenticate: async () => ({ user: { id: "fixture", name: "Test Student" }, jar: new CookieJar() }),
    getSnapshot: async () => ({ courses: [{ id: "se", title: "Software engineering", color: "#fab387" }], resources: [] }),
    moodleClient: {
      courses: async () => ({ site: "Test Moodle", courses: moodleDemo.courses }),
      contents: async () => ({ sections: moodleDemo.sections }),
    },
  });
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(runtime.url);
  await evaluate(`fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password:'fixture'})}).then(r=>{if(!r.ok)throw Error('login')})`);
  await window.loadURL(runtime.url + "/?fixture=1#course=se&tab=moodle");
  await waitFor(`document.querySelector('#moodle-token') && !document.querySelector('#moodle-token').disabled`);
  await evaluate(`
    for (const [id,value] of [['moodle-url','https://moodle.example.edu'],['moodle-token','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']]) {
      const input=document.getElementById(id); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.querySelector('.moodle-connect').requestSubmit();
  `);
  await waitFor(`document.querySelector('#moodle-course') && !document.querySelector('#moodle-course').disabled`);
  assert.equal(await evaluate(`document.querySelector('#moodle-token')`), null);
  await evaluate(`const select=document.querySelector('#moodle-course');select.value='42';select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(`document.querySelectorAll('.moodle-topic').length===2`);
  await window.reload();
  await waitFor(`document.querySelectorAll('.moodle-topic').length===2`);
  assert.equal(await evaluate(`document.querySelector('#moodle-course').value`), "42");
  assert.ok(!(await evaluate(`JSON.stringify(localStorage)`)).includes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Disconnect').click()`);
  await waitFor(`document.querySelector('#moodle-token') && !document.querySelector('#moodle-token').disabled`);
  assert.equal(await evaluate(`fetch('/api/moodle/courses').then(r=>r.json()).then(d=>d.connected)`), false);
  console.log("Moodle UI passed: connect, course selection, reload, token privacy, disconnect");
})().then(async () => {
  clearTimeout(deadline); window?.destroy(); await runtime?.close(); await rm(directory, { recursive: true, force: true }); app.exit(0);
}).catch(async error => {
  console.error(error); clearTimeout(deadline); window?.destroy(); await runtime?.close(); if (directory) await rm(directory, { recursive: true, force: true }); app.exit(1);
});
