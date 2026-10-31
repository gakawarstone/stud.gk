const { spawn } = require("node:child_process");
const { stat } = require("node:fs/promises");
const path = require("node:path");

async function projectDirectory(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)) {
    throw new Error("Enter an absolute path to your local project folder.");
  }
  const directory = path.normalize(value);
  try {
    if ((await stat(directory)).isDirectory()) return directory;
  } catch {}
  throw new Error("This folder does not exist or cannot be accessed. Choose your local project folder.");
}

function startLauncher(command, args) {
  return new Promise((resolve, reject) => {
    // Pass the path as one argument. Never interpret user input in a shell.
    const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

async function launchIdeaProject(directory, { platform = process.platform, launch = startLauncher } = {}) {
  const commands = platform === "darwin" ? [["/usr/bin/open", ["-a", "IntelliJ IDEA", directory]]]
    : (platform === "win32" ? ["idea64.exe", "idea.exe"] : ["idea", "idea.sh", "idea-community", "idea-ultimate"])
      .map((command) => [command, [directory]]);
  for (const [command, args] of commands) {
    try { await launch(command, args); return directory; }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error("Could not start IntelliJ IDEA. Check your IDEA installation and try again.");
    }
  }
  throw new Error("IDEA launcher not found. Add the IntelliJ IDEA bin folder or Toolbox launcher to PATH, then restart Stud.GK.");
}

async function openIdeaProject(value, options) {
  return launchIdeaProject(await projectDirectory(value), options);
}

function registerIdeaIpc({ ipcMain, BrowserWindow, dialog, isTrusted }) {
  function checkSender(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isTrusted(event.senderFrame.url)) {
      throw new Error("Local project access is only available from the Stud.GK window.");
    }
  }
  ipcMain.handle("idea:choose-directory", async (event) => {
    checkSender(event);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: "Choose local project folder", buttonLabel: "Use this folder", properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("idea:open-project", async (event, directory) => {
    checkSender(event);
    let validated;
    try {
      validated = await projectDirectory(directory);
      await launchIdeaProject(validated);
      return { ok: true, path: validated };
    } catch (error) { return { ok: false, error: error.message, ...(validated ? { path: validated } : {}) }; }
  });
}

module.exports = { openIdeaProject, projectDirectory, registerIdeaIpc };
