const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { openIdeaProject, projectDirectory, registerIdeaIpc } = require("./idea.cjs");

test("IDEA receives one absolute directory argument, including spaces and shell characters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "stud-gk-idea-"));
  try {
    const directory = path.join(root, "Course project & $(echo nope) # ü");
    await mkdir(directory);
    const calls = [];
    const launch = async (command, args) => { calls.push({ command, args }); };
    assert.equal(await openIdeaProject(directory, { platform: "linux", launch }), directory);
    assert.deepEqual(calls, [{ command: "idea", args: [directory] }]);
    calls.length = 0;
    await openIdeaProject(directory, { platform: "darwin", launch });
    assert.deepEqual(calls, [{ command: "/usr/bin/open", args: ["-a", "IntelliJ IDEA", directory] }]);
    calls.length = 0;
    await openIdeaProject(directory, { platform: "win32", launch });
    assert.deepEqual(calls, [{ command: "idea64.exe", args: [directory] }]);
    await assert.rejects(openIdeaProject(directory, { launch: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } }), /launcher not found/);
    await assert.rejects(openIdeaProject(directory, { launch: async () => { throw Object.assign(new Error(), { code: "EACCES" }); } }), /Could not start/);
    const file = path.join(root, "file");
    await writeFile(file, "fixture");
    for (const invalid of [null, {}, "", "relative/project", "--help", "https://example.com", directory + "\0", directory + "\n"]) {
      await assert.rejects(projectDirectory(invalid), /absolute path/);
    }
    await assert.rejects(projectDirectory(file), /folder does not exist/);
    await assert.rejects(projectDirectory(path.join(root, "missing")), /folder does not exist/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("IDEA IPC rejects remote pages and subframes, and handles folder picker cancellation", async () => {
  const handlers = new Map();
  let dialogs = 0;
  registerIdeaIpc({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    BrowserWindow: { fromWebContents: () => ({}) },
    dialog: { showOpenDialog: async () => { dialogs++; return { canceled: true, filePaths: [] }; } },
    isTrusted: (url) => new URL(url).origin === "http://127.0.0.1:3000",
  });
  const mainFrame = { url: "http://127.0.0.1:3000" };
  const sender = { mainFrame };
  assert.equal(await handlers.get("idea:choose-directory")({ sender, senderFrame: mainFrame }), null);
  assert.equal(dialogs, 1);
  for (const senderFrame of [null, { url: mainFrame.url }, { url: "https://example.com" }]) {
    for (const handler of handlers.values()) {
      await assert.rejects(handler({ sender, senderFrame }), /only available/);
    }
  }
  const remote = { url: "https://example.com" };
  await assert.rejects(handlers.get("idea:choose-directory")({ sender: { mainFrame: remote }, senderFrame: remote }), /only available/);
  assert.equal(dialogs, 1);
});
