const { app, BrowserWindow, dialog } = require("electron");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
let profile;
const timeout = setTimeout(() => { console.error("IDEA smoke timed out"); app.exit(1); }, 30000);
async function evaluate(window, expression) { return window.webContents.executeJavaScript(expression); }
async function waitFor(window, expression) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(window, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function fill(window, selector, value) {
  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function click(window, selector) {
  await evaluate(window, `(() => { const target = document.querySelector(${JSON.stringify(selector)}); target.focus(); target.click(); })()`);
}
async function screenshot(window, name) {
  if (!process.env.CAMPUS_IDEA_SCREENSHOTS) return;
  await evaluate(window, "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  await writeFile(path.join(process.env.CAMPUS_IDEA_SCREENSHOTS, name), (await window.webContents.capturePage()).toPNG());
}
(async () => {
  // Run the real preload and main-process handlers in an isolated profile.
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-idea-smoke-"));
  app.setPath("appData", profile);
  const directory = path.join(profile, "IdeaProjects", "web-mobile & Kotlin");
  await mkdir(directory, { recursive: true });
  const launches = [];
  let failLauncher = false;
  childProcess.spawn = (command, args, options) => {
    launches.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit(failLauncher ? "error" : "spawn", Object.assign(new Error(), { code: "ENOENT" })));
    return child;
  };
  const entry = process.env.CAMPUS_SMOKE_ENTRY || path.resolve(__dirname, "../electron/main.cjs");
  const { window, runtime } = await require(entry).ready;
  const errors = require("./renderer-errors.cjs")(window);
  window.setSize(1440, 900);
  assert.equal(await evaluate(window, "typeof window.studGkDesktop.openIdeaProject"), "function");
  assert.equal(await evaluate(window, "typeof require"), "undefined");
  await waitFor(window, "document.querySelector('.demo-link')");
  await click(window, ".demo-link");
  await waitFor(window, "document.querySelector('.course-card-link')");
  await click(window, ".course-card-link");
  await waitFor(window, "document.querySelector('[aria-label=\"Add tab\"]')");
  await click(window, '[aria-label="Add tab"]');
  await click(window, '[aria-label="Add GitLab"]');
  await waitFor(window, "document.querySelector('#gitlab-project-url')");
  const projectUrl = "https://gitlab.example/course/web-mobile";
  const storageKey = `stud-gk-idea-project:${projectUrl}`;
  await fill(window, "#gitlab-project-url", projectUrl);
  await evaluate(window, "document.querySelector('.gitlab-project-form').requestSubmit()");
  await waitFor(window, "document.querySelector('.gitlab-idea-open') && document.querySelector('[data-entry-path=\"README.md\"]')");
  await screenshot(window, "01-open-in-idea.png");
  await click(window, ".gitlab-idea-open");
  await waitFor(window, "document.querySelector('.idea-project-dialog[open]')");
  assert.equal(await evaluate(window, "document.activeElement === document.querySelector('.idea-project-path input')"), true);
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-dialog button[type=submit]').disabled"), true);
  await fill(window, ".idea-project-path input", "/home/johann/IdeaProjects/web-mobile");
  await screenshot(window, "02-local-project-setup.png");
  // Cancel and Escape must not launch IDEA or save the draft.
  await click(window, '[aria-label="Close IDEA setup"]');
  assert.equal(launches.length, 0);
  assert.equal(await evaluate(window, `localStorage.getItem(${JSON.stringify(storageKey)})`), null);
  assert.equal(await evaluate(window, "document.activeElement.classList.contains('gitlab-idea-open')"), true);
  await click(window, ".gitlab-idea-open");
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(window, "!document.querySelector('.idea-project-dialog')");
  await click(window, ".gitlab-idea-open");
  let pickerCalls = 0;
  dialog.showOpenDialog = async () => { pickerCalls++; return { canceled: true, filePaths: [] }; };
  await click(window, ".idea-browse");
  await waitFor(window, "!document.querySelector('.idea-browse').disabled");
  assert.equal(pickerCalls, 1);
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-path input').value"), "");
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  await click(window, ".idea-browse");
  await waitFor(window, "document.querySelector('.idea-project-path input').value !== ''");
  await evaluate(window, "document.querySelector('.idea-project-dialog form').requestSubmit()");
  await waitFor(window, "!document.querySelector('.idea-project-dialog') && document.querySelector('.idea-feedback')");
  assert.deepEqual(launches[0], { command: "idea", args: [directory], options: { detached: true, stdio: "ignore", shell: false } });
  assert.equal(await evaluate(window, `localStorage.getItem(${JSON.stringify(storageKey)})`), directory);
  await screenshot(window, "03-launch-request.png");
  const count = launches.length;
  await click(window, ".gitlab-idea-open");
  await waitFor(window, `document.querySelector('.idea-feedback')`);
  assert.equal(launches.length, count + 1);
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-dialog')"), null);
  // Reload restores the per-project mapping and opens without another setup.
  window.reload();
  await waitFor(window, "document.querySelector('.demo-link')");
  await click(window, ".demo-link");
  await waitFor(window, "document.querySelector('.gitlab-idea-open')");
  await click(window, ".gitlab-idea-open");
  await waitFor(window, "document.querySelector('.idea-feedback')");
  assert.equal(launches.at(-1).args[0], directory);
  // Existing paths can be changed from the project settings menu.
  await click(window, '[aria-label="GitLab settings"]');
  await waitFor(window, "document.querySelector('.gitlab-settings-menu')");
  await screenshot(window, "04-project-settings.png");
  await evaluate(window, "Array.from(document.querySelectorAll('.gitlab-settings-menu button')).find(b=>b.textContent.includes('Local IDEA')).click()");
  await waitFor(window, "document.querySelector('.idea-project-dialog[open]')");
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-path input').value"), directory);
  // Nonexistent folders produce an actionable error without launching a process.
  const beforeInvalid = launches.length;
  await fill(window, ".idea-project-path input", path.join(profile, "missing"));
  await evaluate(window, "document.querySelector('.idea-project-dialog form').requestSubmit()");
  await waitFor(window, "document.querySelector('.idea-project-error')?.textContent.includes('does not exist')");
  assert.equal(launches.length, beforeInvalid);
  assert.equal(await evaluate(window, `localStorage.getItem(${JSON.stringify(storageKey)})`), directory);
  await fill(window, ".idea-project-path input", directory);
  failLauncher = true;
  await evaluate(window, "document.querySelector('.idea-project-dialog form').requestSubmit()");
  await waitFor(window, "document.querySelector('.idea-project-error')?.textContent.includes('launcher not found')");
  assert.equal(await evaluate(window, `localStorage.getItem(${JSON.stringify(storageKey)})`), directory);
  window.setSize(480, 850);
  await evaluate(window, "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  assert.equal(await evaluate(window, "document.documentElement.scrollWidth > innerWidth"), false);
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-dialog').scrollWidth > document.querySelector('.idea-project-dialog').clientWidth"), false);
  failLauncher = false;
  await evaluate(window, "document.querySelector('.idea-project-dialog form').requestSubmit()");
  await waitFor(window, "!document.querySelector('.idea-project-dialog')");
  // A second repository needs its own path.
  await click(window, ".gitlab-project-trigger");
  await waitFor(window, "document.querySelector('.gitlab-add-project')");
  await click(window, ".gitlab-add-project");
  await fill(window, "#gitlab-project-url", "https://gitlab.example/course/exercises");
  await evaluate(window, "document.querySelector('.gitlab-project-form').requestSubmit()");
  await waitFor(window, "document.querySelector('.gitlab-idea-open')");
  await click(window, ".gitlab-idea-open");
  await waitFor(window, "document.querySelector('.idea-project-dialog[open]')");
  assert.equal(await evaluate(window, "document.querySelector('.idea-project-path input').value"), "");
  // The bridge remains scoped to the app's own main frame.
  const foreign = new BrowserWindow({ show: false, webPreferences: { preload: path.resolve(__dirname, "../electron/preload.cjs"), sandbox: true, contextIsolation: true } });
  await foreign.loadURL("data:text/html,<p>Untrusted page</p>");
  assert.match(await evaluate(foreign, "window.studGkDesktop.openIdeaProject('/tmp').then(()=>'',e=>e.message)"), /only available/);
  foreign.destroy();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", checks: "real sandboxed preload and IPC, first-use setup, native picker and cancellation, focus and Escape, one-click launch, path persistence, project isolation, settings editing, invalid folder, missing launcher, shell-safe arguments, narrow layout, untrusted sender rejection" }));
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(timeout);
  app.quit();
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
