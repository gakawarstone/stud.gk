// Run against a production build, one Electron process at a time under Xvfb.
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile, readFile } = require("node:fs/promises");
const { tmpdir, cpus, release } = require("node:os");
const path = require("node:path");
const { gzipSync } = require("node:zlib");
const { pathToFileURL } = require("node:url");
app.disableHardwareAcceleration();
let runtime, profile;
const watchdog = setTimeout(() => {
  console.error("Benchmark timed out");
  app.exit(1);
}, 120000);
async function waitFor(window, expression) {
  for (let i = 0; i < 400; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function measure(window, action, condition) {
  return window.webContents.executeJavaScript(`(async () => {
    const start = performance.now(); ${action};
    while (!(${condition})) await new Promise(r => setTimeout(r, 0));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - start;
  })()`);
}
(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-benchmark-"));
  app.setPath("userData", profile);
  await app.whenReady();
  const root = path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  const { CookieJar } = await import("tough-cookie");
  runtime = await startServer({
    dataDir: path.join(profile, "data"),
    autoSync: false,
    authenticate: async () => ({
      jar: new CookieJar(),
      user: { id: "benchmark", name: "Benchmark" },
    }),
    getSnapshot: async () => ({
      courses: [{ id: "c1", title: "Benchmark course", color: "blue", url: null }],
      // Text files deliberately avoid thumbnail IO and PDF workers.
      resources: Array.from({ length: 1000 }, (_, i) => ({
        id: `file-${i}`,
        kind: "file",
        courseId: "c1",
        title: `File ${i}.txt`,
        remoteId: `remote-${i}`,
        createdAt: "2026-10-01T12:00:00Z",
      })),
    }),
    getGitlabBranches: async () => ({
      branches: [{ name: "main", default: true, commit: null }],
    }),
    getGitlabTree: async (_url, folder) => ({
      branch: "main",
      path: folder,
      entries: folder
        ? Array.from({ length: 1000 }, (_, i) => ({
            path: `src/file-${i}.ts`,
            name: `file-${i}.ts`,
            directory: false,
          }))
        : [
            { path: "src", name: "src", directory: true },
            ...Array.from({ length: 1999 }, (_, i) => ({
              path: `file-${i}.ts`,
              name: `file-${i}.ts`,
              directory: false,
            })),
          ],
    }),
  });
  const window = new BrowserWindow({
    show: true,
    width: 1280,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(runtime.url);
  await waitFor(window, `!!document.querySelector('#username')`);
  await window.webContents.executeJavaScript(`(() => {
    for (const id of ['username','password']) { const input = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture'); input.dispatchEvent(new Event('input',{bubbles:true})); }
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('form').requestSubmit()`);
  await waitFor(window, `!!document.querySelector('.course-card-link')`);
  const list = [];
  // First iteration warms parsing/layout; keep the following nine.
  for (let i = 0; i < 10; i++) {
    const ms = await measure(
      window,
      `document.querySelector('.course-card-link').click()`,
      `document.querySelectorAll('.file-card').length === 1000`,
    );
    if (i) list.push(ms);
    await measure(
      window,
      `document.querySelector('.back-to-courses').click()`,
      `!!document.querySelector('.course-card-link')`,
    );
  }
  await window.webContents.executeJavaScript(
    `fetch('/api/courses/c1/gitlab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://gitlab.example/team/project'})})`,
  );
  await window.reload();
  await waitFor(window, `!!document.querySelector('.course-card-link')`);
  await window.webContents.executeJavaScript(`location.hash = 'course=c1&tab=gitlab'`);
  await waitFor(window, `document.querySelectorAll('[role="treeitem"]').length === 2000`);
  const expand = [],
    keyboard = [];
  for (let i = 0; i < 10; i++) {
    const ms = await measure(
      window,
      `document.querySelector('[data-entry-path="src"]').click()`,
      `document.querySelectorAll('[role="treeitem"]').length === 3000`,
    );
    if (i) expand.push(ms);
    const keyMs = await measure(
      window,
      `document.querySelector('[data-entry-path="src"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
      `document.activeElement?.dataset.entryPath === 'src/file-0.ts'`,
    );
    if (i) keyboard.push(keyMs);
    await measure(
      window,
      `document.querySelector('[data-entry-path="src"]').click()`,
      `document.querySelectorAll('[role="treeitem"]').length === 2000`,
    );
  }
  await measure(
    window,
    `document.querySelector('[data-entry-path="src"]').click()`,
    `document.querySelectorAll('[role="treeitem"]').length === 3000`,
  );
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 1000));
  const heap = await window.webContents.debugger.sendCommand("Runtime.getHeapUsage");
  const metrics = app.getAppMetrics().map(({ type, memory }) => ({
    type,
    workingSetKiB: memory.workingSetSize,
  }));
  assert.ok(metrics.some((m) => m.type === "Tab"));
  const html = await readFile(path.join(root, "dist/index.html"), "utf8");
  const initial = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
  const assets = await Promise.all(
    initial.map(async (url) => {
      const data = await readFile(path.join(root, "dist", url));
      return { url, bytes: data.length, gzipBytes: gzipSync(data).length };
    }),
  );
  const result = {
    label: process.env.BENCH_LABEL || "unknown",
    fixture: {
      files: 1000,
      rootEntries: 2000,
      expandedEntries: 3000,
      width: 1280,
      height: 850,
    },
    environment: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      os: release(),
      cpu: cpus()[0].model,
      hardwareAcceleration: false,
    },
    initialJs: assets,
    milliseconds: { list, expand, keyboard },
    memory: {
      metrics,
      totalWorkingSetKiB: metrics.reduce((s, m) => s + m.workingSetKiB, 0),
      rendererHeapUsedBytes: heap.usedSize,
    },
  };
  console.log(JSON.stringify(result));
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(result, null, 2) + "\n");
  window.destroy();
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(watchdog);
  app.quit();
})().catch(async (error) => {
  console.error(error);
  clearTimeout(watchdog);
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  await runtime?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
  app.exit(1);
});
