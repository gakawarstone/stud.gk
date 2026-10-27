const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const timer = setTimeout(() => { console.error("GitLab README smoke timed out"); app.exit(1); }, 30000);
let runtime, profile;
async function waitFor(window, expression) {
  for (let i = 0; i < 100; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function fill(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
}
(async () => {
  profile = await mkdtemp(path.join(tmpdir(), "stud-gk-readme-"));
  app.setPath("userData", profile);
  await app.whenReady();
  const root = process.env.CAMPUS_SMOKE_ROOT || path.resolve(__dirname, "..");
  const { startServer } = await import(pathToFileURL(path.join(root, "server/runtime.js")).href);
  const { CookieJar } = await import("tough-cookie");
  const { GitlabError } = await import(pathToFileURL(path.join(root, "server/gitlab-client.js")).href);
  const token = "smoke-private-token";
  const markdown = '# Actual fixture README\n\nA **private project**.\n\n| Task | State |\n| --- | --- |\n| README | Ready |\n\n```sh\nnpm install\n```\n\n[Guide](docs/guide.md)\n\n<script>window.readmeInjected = true</script>\n\n[Unsafe](javascript:alert(1))';
  const treeRequests = [];
  const historyRequests = [], diffRequests = [];
  let failDiff = true;
  function fixtureCommit(letter, title) {
    return { id: letter.repeat(40), shortId: letter.repeat(8), title, author: "Ada", committedAt: "2026-10-16T12:00:00Z",
      webUrl: "https://gitlab.example/team/project/-/commit/" + letter.repeat(40) };
  }
  runtime = await startServer({ root, dataDir: path.join(profile, "data"), autoSync: false,
    authenticate: async () => ({ jar: new CookieJar(), user: { id: "fixture", name: "Fixture" } }),
    getSnapshot: async () => ({ courses: [
      { id: "c1", title: "GitLab course", color: "blue", url: null },
      { id: "c2", title: "Second course", color: "blue", url: null },
    ], resources: [] }),
    getGitlabReadme: async (_url, options) => {
      if (options.token !== token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
      return { branch: "main", readme: { path: "README.md", content: markdown, markdown: true, webUrl: "https://gitlab.example/team/project/-/blob/main/README.md" } };
    },
    getGitlabBranches: async (_url, options) => {
      if (options.token !== token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
      return { branches: ["main", "feature/kotlin"].map((name, index) => ({ name, default: !index,
        commit: { id: (index ? "b" : "a").repeat(40), shortId: (index ? "b" : "a").repeat(8),
          title: index ? "Add Kotlin support" : "Update course materials", author: "Ada", committedAt: "2026-10-16T12:00:00Z",
          webUrl: "https://gitlab.example/team/project/-/commit/" + (index ? "b" : "a").repeat(40) } })) };
    },
    getGitlabCommits: async (_url, options) => {
      assert.equal(options.token, token);
      historyRequests.push({ ref: options.ref, page: options.page });
      if (options.ref === "feature/kotlin") return { commits: [fixtureCommit("b", "Add Kotlin support")], nextPage: null };
      return options.page === "2" ? { commits: [fixtureCommit("c", "Initial commit")], nextPage: null }
        : { commits: [fixtureCommit("a", "Update course materials"), fixtureCommit("d", "Rename guide")], nextPage: 2 };
    },
    getGitlabCommit: async (_url, sha, options) => {
      assert.equal(options.token, token); diffRequests.push({ sha, page: options.page });
      if (failDiff) { failDiff = false; throw new GitlabError("Fixture diff unavailable", 502); }
      const first = sha === "a".repeat(40), renamed = sha === "d".repeat(40);
      const file = (oldPath, newPath, patch, flags = {}) => ({ oldPath, newPath, diff: patch, newFile: false, deletedFile: false,
        renamedFile: false, collapsed: false, tooLarge: false, oldMode: "100644", newMode: "100644", ...flags });
      return { commit: { ...fixtureCommit(sha[0], first ? "Update course materials" : renamed ? "Rename guide" : "Add Kotlin support"), message: "Full commit message\n\nCourse details" },
        diffs: options.page === "2" ? [file("image.png", "image.png", "", { newFile: true }), file("large.txt", "large.txt", "", { tooLarge: true })]
          : [file(renamed ? "old.md" : "src/index.ts", renamed ? "guide.md" : "src/index.ts",
            "@@ -8,2 +8,2 @@\n-export const answer = 41;\n+export const answer = 42;\n <img src=x onerror=alert(1)>\n", { renamedFile: renamed })], nextPage: first && options.page !== "2" ? 2 : null };
    },
    getGitlabTree: async (_url, folder, options) => {
      if (options.token !== token) throw new GitlabError("Private project", 403, "GITLAB_AUTH_REQUIRED");
      treeRequests.push(folder);
      if (options.ref === "feature/kotlin") return { branch: options.ref, path: folder, entries: [{ path: "Main.kt", name: "Main.kt", directory: false }] };
      return { branch: "main", path: folder, entries: folder === "src/components"
        ? [{ path: "src/components/Button.tsx", name: "Button.tsx", directory: false }]
        : folder === "src" ? [{ path: "src/components", name: "components", directory: true }, { path: "src/index.ts", name: "index.ts", directory: false }]
        : [{ path: "src", name: "src", directory: true }, { path: "README.md", name: "README.md", directory: false }] };
    },
    getGitlabFile: async (_url, file, options) => {
      assert.equal(options.token, token); assert.ok(["main", "feature/kotlin"].includes(options.ref));
      return { path: file, content: file === "README.md" ? markdown : file === "Main.kt" ? 'fun main() { println("Kotlin") }' : 'export const answer: number = 42;\nconst html = "<img src=x onerror=alert(1)>";\n' + Array.from({ length: 120 }, (_, i) => `const value${i}: string = "${'source '.repeat(35)}";`).join('\n'),
        binary: false, size: 100, webUrl: `https://gitlab.example/team/project/-/blob/main/${file}` };
    },
  });
  const window = new BrowserWindow({ show: false, width: 1280, height: 850,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  if (process.env.CAMPUS_SMOKE_SCREENSHOT || process.env.CAMPUS_SMOKE_CODE_SCREENSHOT) window.showInactive();
  await window.loadURL(runtime.url);
  await waitFor(window, `document.querySelector('#username') !== null`);
  await fill(window, "#username", "fixture");
  await fill(window, "#password", "fixture");
  await window.webContents.executeJavaScript(`document.querySelector('.login-card form').requestSubmit()`);
  await waitFor(window, `document.querySelector('.course-card-link') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.course-card-link').click()`);
  await waitFor(window, `document.querySelector('.back-to-courses') !== null`);
  await window.webContents.executeJavaScript(`(() => {
    const add = document.querySelector('button[aria-label="Добавить вкладку"]');
    if (add) add.click(); else document.querySelector('.course-tabs a[href*="gitlab"]').click();
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Добавить GitLab"]')?.click()`);
  await waitFor(window, `document.querySelector('#gitlab-project-url') !== null`);
  await fill(window, "#gitlab-project-url", "https://gitlab.example/team/project");
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-form').requestSubmit()`);
  await waitFor(window, `document.querySelector('#gitlab-access-token') !== null`);
  const createTokenUrl = new URL(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-create-token').href`));
  assert.equal(createTokenUrl.origin, "https://gitlab.example");
  assert.equal(createTokenUrl.pathname, "/-/user_settings/personal_access_tokens");
  assert.equal(createTokenUrl.searchParams.get("name"), "Stud.GK");
  assert.equal(createTokenUrl.searchParams.get("scopes"), "read_api");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-create-token').target`), "_blank");
  window.setSize(480, 950);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth > innerWidth`), false);
  window.setSize(1280, 1000);
  if (process.env.CAMPUS_SMOKE_TOKEN_SCREENSHOT)
    await writeFile(process.env.CAMPUS_SMOKE_TOKEN_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  await fill(window, "#gitlab-access-token", token);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-token-form').requestSubmit()`);
  await waitFor(window, `document.querySelector('[role="treeitem"][data-entry-path="README.md"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[role="treeitem"]').length`), 2);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-files, .gitlab-panel, .gitlab-readme-preview')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-preview-empty').textContent`), "Выбери файл в дереве");
  if (await window.webContents.executeJavaScript(`!!document.querySelector('.course-sidebar')`))
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.course-toolbar .gitlab-tools') !== null`));
  assert.equal((await readFile(path.join(profile, "data/sessions.enc"), "utf8")).includes(token), false);
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/index.ts"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').getAttribute('aria-expanded')`), "true");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/index.ts"]').getAttribute('aria-level')`), "2");
  assert.ok(await window.webContents.executeJavaScript(`!!document.querySelector('[data-entry-path="README.md"]')`));
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/index.ts"]') === null`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/index.ts"]') !== null`);
  assert.equal(treeRequests.filter(path => path === "src").length, 1, "Reopening a folder uses its cached children");
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/components"]').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/components/Button.tsx"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/components/Button.tsx"]').getAttribute('aria-level')`), "3");
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/index.ts"]').focus()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await waitFor(window, `document.querySelector('.gitlab-inline-viewer .hljs-keyword') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-inline-viewer').getAttribute('aria-label')`), "src/index.ts");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/index.ts"]').getAttribute('aria-selected')`), "true");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('dialog.gitlab-viewer')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-inline-viewer img')`), null);
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-source').textContent`), /export const answer/);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-inline-viewer .gitlab-viewer-toolbar, .gitlab-file-actions')`), null);
  await waitFor(window, `document.querySelector('.gitlab-preview-pane > .gitlab-commit-bar .gitlab-commit-title') !== null`);
  assert.ok(await window.webContents.executeJavaScript(`(() => {
    const sidebar = document.querySelector('.gitlab-repo-sidebar').getBoundingClientRect();
    const browser = document.querySelector('.gitlab-browser').getBoundingClientRect();
    const branch = document.querySelector('.gitlab-branch-trigger').getBoundingClientRect();
    const commit = document.querySelector('.gitlab-commit-bar').getBoundingClientRect();
    const toolbar = document.querySelector('.gitlab-repo-toolbar').getBoundingClientRect();
    const preview = document.querySelector('.gitlab-preview-pane').getBoundingClientRect();
    const body = document.querySelector('.gitlab-viewer-body').getBoundingClientRect();
    return Math.abs(browser.top - commit.top) < 1 && Math.abs(sidebar.bottom - preview.bottom) < 1
      && toolbar.bottom <= sidebar.top && Math.abs(commit.top - preview.top) < 1
      && Math.abs((branch.top + branch.bottom) / 2 - (commit.top + commit.bottom) / 2) < 1
      && branch.height >= 32 && branch.width >= 90 && branch.width < sidebar.width - 30
      && commit.left >= preview.left && commit.bottom < body.top;
  })()`), 'The commit strip starts at the top of the repository and aligns with the compact branch button');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-repo-sidebar .gitlab-commit-bar, .gitlab-repo-views')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.body.innerText.includes('Файлы проекта') || document.body.innerText.includes('1 изменённый файл') || document.body.innerText.includes('Kotlin · UTF-8')`), false);
  await window.webContents.executeJavaScript(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedGitlabSha = value; } } }); document.querySelector('.gitlab-copy-sha').click()`);
  await waitFor(window, `window.copiedGitlabSha === '${'a'.repeat(40)}'`);
  await waitFor(window, `document.querySelector('.gitlab-commit-actions [role="status"]').textContent === 'SHA скопирован'`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').scrollHeight > document.querySelector('.gitlab-viewer-body').clientHeight`));
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').scrollWidth > document.querySelector('.gitlab-viewer-body').clientWidth`));
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.gitlab-viewer-body'), '::-webkit-scrollbar').display`), 'none');
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.gitlab-viewer-body')).scrollbarWidth`), 'none');
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').scrollTop = 200`);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').scrollTop > 0`));
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').scrollTop = 0`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (process.env.CAMPUS_SMOKE_CODE_SCREENSHOT)
    await writeFile(process.env.CAMPUS_SMOKE_CODE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Настройки GitLab"]').click()`);
  await waitFor(window, `document.querySelector('.gitlab-settings-menu') !== null`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-settings-menu [role="menuitem"]')).find(b => b.textContent.includes('Обновить')).click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/components/Button.tsx"]') !== null && document.querySelector('.gitlab-source') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src/components"]').getAttribute('aria-expanded')`), "true");
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="src/index.ts"]') === null`);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').focus()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(window, `document.querySelector('.gitlab-inline-viewer') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.entryPath`), "src");
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]').click()`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="README.md"]').click()`);
  await waitFor(window, `document.querySelector('.gitlab-inline-viewer .gitlab-markdown h1')?.textContent === 'Actual fixture README'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-markdown strong').textContent`), "private project");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.gitlab-markdown tbody tr').length`), 1);
  assert.equal(await window.webContents.executeJavaScript(`window.readmeInjected`), undefined);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-markdown script, .gitlab-markdown a[href^="javascript:"]')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(token)})`), false);
  window.setSize(480, 850);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth > innerWidth`), false);
  window.setSize(1280, 1000);
  if (process.env.CAMPUS_SMOKE_SCREENSHOT)
    await writeFile(process.env.CAMPUS_SMOKE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-viewer-body').focus()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(window, `document.querySelector('.gitlab-inline-viewer') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.entryPath`), "README.md");
  await waitFor(window, `document.querySelector('.gitlab-commit-bar')?.textContent.includes('Update course materials')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-repository-name, .gitlab-branch-picker select')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-author').textContent`), "Ada");
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-meta time').textContent.length > 0`));
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-title').click()`);
  await waitFor(window, `document.querySelector('.gitlab-history-list li') !== null && document.querySelector('.gitlab-commit-viewer [role="alert"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-toggle').getAttribute('aria-pressed')`), "true");
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-viewer .text-button').click()`);
  await waitFor(window, `document.querySelector('.gitlab-diff-add') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-diff-remove .gitlab-diff-number').textContent`), "8");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.gitlab-diff-add .gitlab-diff-number')[1].textContent`), "8");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-diff-lines img')`), null);
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-message').textContent`), /Course details/);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-pane .gitlab-load-more').click()`);
  await waitFor(window, `document.querySelectorAll('.gitlab-history-list li').length === 3`);
  assert.deepEqual(historyRequests.slice(-2), [{ ref: "main", page: "1" }, { ref: "main", page: "2" }]);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-viewer .gitlab-load-more').click()`);
  await waitFor(window, `document.querySelectorAll('.gitlab-diff-file').length === 3`);
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-diffs').textContent`), /бинарный/);
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-diffs').textContent`), /GitLab не вернул/);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-viewer .gitlab-load-more')`), null);
  window.setSize(480, 850);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await window.webContents.executeJavaScript(`document.documentElement.scrollWidth > innerWidth`), false);
  window.setSize(1280, 1000);
  if (process.env.CAMPUS_SMOKE_HISTORY_SCREENSHOT)
    await writeFile(process.env.CAMPUS_SMOKE_HISTORY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelectorAll('.gitlab-history-commit')[1].click()`);
  await waitFor(window, `document.querySelector('.gitlab-diff-path')?.textContent === 'old.md → guide.md'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.gitlab-diff-file').length`), 1);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.gitlab-history-commit')[1].getAttribute('aria-current')`), "true");
  assert.equal(diffRequests.at(-1).sha, "d".repeat(40));
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-title').textContent`), "Rename guide");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-sha').textContent`), "dddddddd");
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-header')`), null);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-back').click()`);
  await waitFor(window, `document.querySelector('.gitlab-tree') !== null && document.querySelector('.gitlab-commit-title').textContent === 'Update course materials'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-toggle').getAttribute('aria-pressed')`), "false");
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-toggle').click()`);
  await waitFor(window, `document.querySelector('.gitlab-history-commit') !== null && document.querySelector('.gitlab-diff-path')?.textContent === 'old.md → guide.md'`);

  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-branch-trigger').click()`);
  await waitFor(window, `document.querySelector('[role="dialog"][aria-label="Сменить ветку"]') !== null`);
  if (process.env.CAMPUS_SMOKE_BRANCH_MENU_SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 150));
    await writeFile(process.env.CAMPUS_SMOKE_BRANCH_MENU_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  await fill(window, '.gitlab-branch-search input', 'kotlin');
  await waitFor(window, `document.querySelectorAll('.gitlab-branch-options [role="option"]').length === 1`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Down" });
  await waitFor(window, `document.activeElement?.getAttribute('role') === 'option'`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await waitFor(window, `document.querySelector('.gitlab-branch-popover') === null`);
  await waitFor(window, `document.querySelector('.gitlab-history-commit')?.textContent.includes('Add Kotlin support')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-viewer')`), null);
  assert.equal(historyRequests.at(-1).ref, "feature/kotlin");
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-commit').click()`);
  await waitFor(window, `document.querySelector('.gitlab-commit-title')?.textContent === 'Add Kotlin support' && document.querySelector('.gitlab-diff-file') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-history-back').click()`);
  await waitFor(window, `document.querySelector('[data-entry-path="Main.kt"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="src"]')`), null);
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[data-file-icon="kotlin"]')?.src.includes('data:image/svg+xml')`));
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-commit-bar').textContent`), /Add Kotlin support[\s\S]*Ada/);
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-branch-trigger').click()`);
  await waitFor(window, `document.querySelector('.gitlab-branch-popover') !== null`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(window, `document.querySelector('.gitlab-branch-popover') === null`);
  assert.equal(await window.webContents.executeJavaScript(`document.activeElement.className`), 'gitlab-branch-trigger');
  await window.webContents.executeJavaScript(`document.querySelector('[data-entry-path="Main.kt"]').click()`);
  await waitFor(window, `document.querySelector('.gitlab-source')?.textContent.includes('Kotlin')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-inline-viewer > .gitlab-viewer-toolbar')`), null);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-inline-viewer .gitlab-viewer-toolbar, .gitlab-inline-viewer details, .gitlab-file-actions, [aria-label="Действия с файлом"]')`), null);
  if (process.env.CAMPUS_SMOKE_BRANCH_SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 150));
    await writeFile(process.env.CAMPUS_SMOKE_BRANCH_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Настройки GitLab"]').click()`);
  await waitFor(window, `document.querySelector('.gitlab-settings-menu') !== null`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-settings-menu [role="menuitem"]')).find(b => b.textContent.includes('Доступ')).click()`);
  await waitFor(window, `document.querySelector('.gitlab-token-form [role="status"]')?.textContent.includes('подключён')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#gitlab-access-token, .gitlab-create-token')`), null);
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-token-form').textContent`), /всех твоих проектов/);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-token-form button')).find(b => b.textContent.includes('Заменить')).click()`);
  await waitFor(window, `document.querySelector('#gitlab-access-token') !== null`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-token-form button')).find(b => b.textContent.includes('Отмена')).click()`);

  // Link a different private project in a second course without entering another token.
  await window.webContents.executeJavaScript(`document.querySelector('.back-to-courses').click()`);
  await waitFor(window, `document.querySelectorAll('.course-card-link').length === 2`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.course-card-link')).find(a => a.textContent.includes('Second course')).click()`);
  await waitFor(window, `document.querySelector('button[aria-label="Добавить вкладку"]') !== null`);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Добавить вкладку"]').click()`);
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Добавить GitLab"]').click()`);
  await waitFor(window, `document.querySelector('#gitlab-project-url') !== null`);
  await fill(window, "#gitlab-project-url", "https://gitlab.example/another-group/another-project");
  await window.webContents.executeJavaScript(`document.querySelector('.gitlab-project-form').requestSubmit()`);
  await waitFor(window, `document.querySelector('[data-entry-path="README.md"]') !== null`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.gitlab-token-form')`), null);
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Настройки GitLab"]').click()`);
  await waitFor(window, `document.querySelector('.gitlab-settings-menu') !== null`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-settings-menu [role="menuitem"]')).find(b => b.textContent.includes('Доступ')).click()`);
  await waitFor(window, `document.querySelector('.gitlab-token-form [role="status"]')?.textContent.includes('подключён')`);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.gitlab-token-form button')).find(b => b.textContent.includes('Удалить')).click()`);
  await waitFor(window, `document.querySelector('#gitlab-access-token') !== null && document.querySelector('.gitlab-markdown') === null`);
  console.log(JSON.stringify({ result: "passed", root, checks: "nested tree, folder cache/refresh, keyboard selection, inline highlighted code, compact commit strip, SHA copy, history toggle, hidden scrollbars, commit history and diff pagination, diff retry, line numbers, rename/binary/large patches, branch changes, narrow layout, safe diff text, Markdown, shared token, encrypted session" }));
  window.destroy();
  await runtime.close();
  await rm(profile, { recursive: true, force: true });
  clearTimeout(timer);
  app.quit();
})().catch(async (error) => {
  console.error(error);
  await runtime?.close();
  clearTimeout(timer);
  app.exit(1);
});
