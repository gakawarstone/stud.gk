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
const button = (label) => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
async function signInToMoodle() {
  await waitFor(`document.querySelector('#moodle-password') && !document.querySelector('#moodle-password').disabled`);
  await evaluate(`
    for (const [id, value] of [['moodle-username', 'fixture'], ['moodle-password', 'fixture-password']]) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.querySelector('.moodle-connect').requestSubmit();
  `);
}
async function chooseCourse(id) {
  await waitFor(`document.querySelector('#moodle-course') && !document.querySelector('#moodle-course').disabled`);
  await evaluate(`{
    const select = document.querySelector('#moodle-course');
    select.value = ${JSON.stringify(String(id))};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }`);
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
    getSnapshot: async () => ({ courses: [
      { id: "se", title: "Software Engineering", color: "#fab387" },
      { id: "db", title: "Databases", color: "#89b4fa" },
    ], resources: [] }),
    moodleClient: {
      signIn: async (username, password) => {
        assert.equal(username, "fixture");
        assert.equal(password, "fixture-password");
        return { url: "https://moodle.hs-flensburg.de/", token: "a".repeat(32) };
      },
      courses: async () => ({ site: "Test Moodle", courses: [
        ...moodleDemo.courses,
        { id: 43, title: "Database Design", shortname: "DB-2026" },
      ] }),
      contents: async (_connection, id) => ({
        sections: id === 42 ? moodleDemo.sections : [{ id: 3, title: "Relational models", summary: "", modules: [] }],
      }),
    },
  });
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(runtime.url);
  await evaluate(`fetch('/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fixture',password:'fixture'})}).then(r=>{if(!r.ok)throw Error('login')})`);
  await window.loadURL(runtime.url + "/?fixture=1#course=se&tab=moodle");
  await signInToMoodle();
  await chooseCourse(42);
  assert.equal(await evaluate(`document.querySelector('#moodle-password')`), null);
  assert.equal(await evaluate(`document.querySelector('.moodle-topic')`), null);
  await evaluate(`${button("Link course")}.click()`);
  await waitFor(`document.querySelectorAll('.moodle-topic').length===2`);
  assert.equal(await evaluate(`document.querySelector('.moodle-linked-course h3').textContent`), "Software Engineering");
  await window.reload();
  await waitFor(`document.querySelectorAll('.moodle-topic').length===2`);
  assert.equal(await evaluate(`document.querySelector('#moodle-course')`), null);
  await evaluate(`location.hash = "#course=db&tab=moodle"`);
  await chooseCourse(43);
  assert.equal(await evaluate(`document.querySelector('.moodle-linked-course')`), null);
  await evaluate(`${button("Link course")}.click()`);
  await waitFor(`document.querySelector('.moodle-topic h3')?.textContent === 'Relational models'`);
  await evaluate(`location.hash = "#course=se&tab=moodle"`);
  await waitFor(`document.querySelectorAll('.moodle-topic').length === 2`);
  await evaluate(`${button("Change course")}.click()`);
  await chooseCourse(43);
  await evaluate(`${button("Cancel")}.click()`);
  assert.equal(await evaluate(`document.querySelector('.moodle-linked-course h3').textContent`), "Software Engineering");
  await evaluate(`${button("Change course")}.click()`);
  await chooseCourse(43);
  await evaluate(`${button("Link course")}.click()`);
  await waitFor(`document.querySelector('.moodle-topic h3')?.textContent === 'Relational models'`);
  await evaluate(`${button("Unlink course")}.click()`);
  await waitFor(`document.querySelector('#moodle-course') && !document.querySelector('.moodle-topic')`);
  await window.reload();
  await waitFor(`document.querySelector('#moodle-course') && !document.querySelector('.moodle-topic')`);
  await evaluate(`location.hash = "#course=db&tab=moodle"`);
  await waitFor(`document.querySelector('.moodle-topic h3')?.textContent === 'Relational models'`);
  assert.ok(!(await evaluate(`JSON.stringify(localStorage)`)).includes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
  assert.ok(!(await evaluate(`JSON.stringify(localStorage)`)).includes("fixture-password"));
  await evaluate(`${button("Disconnect Moodle")}.click()`);
  await waitFor(`document.querySelector('#moodle-password') && !document.querySelector('#moodle-password').disabled`);
  assert.equal(await evaluate(`document.querySelector('#moodle-password').value`), "");
  assert.equal(await evaluate(`fetch('/api/moodle/courses').then(r=>r.json()).then(d=>d.connected)`), false);
  await signInToMoodle();
  await waitFor(`document.querySelector('.moodle-topic h3')?.textContent === 'Relational models'`);
  console.log("Moodle UI passed: sign-in, course links, reload, course isolation, change, unlink and reconnect");
})().then(async () => {
  clearTimeout(deadline); window?.destroy(); await runtime?.close(); await rm(directory, { recursive: true, force: true }); app.exit(0);
}).catch(async error => {
  console.error(error); clearTimeout(deadline); window?.destroy(); await runtime?.close(); if (directory) await rm(directory, { recursive: true, force: true }); app.exit(1);
});
