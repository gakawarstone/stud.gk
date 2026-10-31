const { app, BrowserWindow, dialog, Menu, session, shell } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

app.setName("Stud.GK");
app.setDesktopName("stud-gk.desktop");
// Keep the legacy profile path so renaming the app preserves sessions and settings.
app.setPath("userData", path.join(app.getPath("appData"), "Campus"));
const root = path.join(__dirname, "..");
let runtime;
let mainWindow;
let desktopSession;
let quitting = false;

function isLocal(url) {
  try {
    return new URL(url).origin === runtime.url;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) {
    void shell.openExternal(url).catch((error) => console.error(error));
  }
}

function createWindow(url, parent) {
  const window = new BrowserWindow({
    title: "Stud.GK",
    width: 1280,
    height: 850,
    minWidth: 480,
    minHeight: 480,
    backgroundColor: "#1e1e2e",
    icon: path.join(root, "build/icon.png"),
    show: false,
    autoHideMenuBar: true,
    ...(parent ? { parent } : {}),
    webPreferences: {
      session: desktopSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  secureWindow(window);
  return window.loadURL(url).then(() => window);
}

function secureWindow(window) {
  window.webContents.on("will-navigate", (event, target) => {
    if (!isLocal(target)) {
      event.preventDefault();
      openExternal(target);
    }
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (!isLocal(target)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("did-create-window", (child) => secureWindow(child));
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocal(target)) {
      const url = new URL(target);
      if (url.pathname === "/" && url.hash.startsWith("#pdf=")) {
        return {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            title: "PDF | Stud.GK",
            width: 1100,
            height: 850,
            minWidth: 480,
            minHeight: 480,
            backgroundColor: "#1e1e2e",
            icon: path.join(root, "build/icon.png"),
            autoHideMenuBar: true,
            webPreferences: {
              session: desktopSession,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
            },
          },
        };
      }
      void createWindow(target, mainWindow).catch(showError);
    } else {
      openExternal(target);
    }
    return { action: "deny" };
  });
}

function showError(error) {
  console.error(error);
  dialog.showErrorBox("Stud.GK", `Cannot start Stud.GK.\n\n${error.message}`);
  app.quit();
}

async function start() {
  await app.whenReady();
  const { startServer } = await import(
    pathToFileURL(path.join(root, "server/runtime.js")).href
  );
  const dataDir = path.join(app.getPath("userData"), "data");
  const portFile = path.join(app.getPath("userData"), "desktop-port.json");
  let port = 0;
  try {
    const saved = JSON.parse(await readFile(portFile, "utf8"));
    if (Number.isInteger(saved.port) && saved.port > 0 && saved.port <= 65535) {
      port = saved.port;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    runtime = await startServer({ root, dataDir, port });
  } catch (error) {
    if (error.code !== "EADDRINUSE" || port === 0) throw error;
    runtime = await startServer({ root, dataDir });
  }
  // Reusing the origin preserves localStorage, including course ordering.
  await writeFile(portFile, JSON.stringify({ port: runtime.port }), { mode: 0o600 });
  desktopSession = session.fromPartition("persist:campus");
  desktopSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === "notifications" && isLocal(contents.getURL()));
  });
  desktopSession.setPermissionCheckHandler((contents, permission, origin) =>
    permission === "notifications" && isLocal(origin),
  );
  desktopSession.on("will-download", (event, item) => {
    if (!item.getURLChain().every(isLocal)) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({ title: "Save file", buttonLabel: "Save" });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Stud.GK", submenu: [{ role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
  ]));
  mainWindow = await createWindow(runtime.url);
  mainWindow.on("closed", () => { mainWindow = null; });
  return { window: mainWindow, runtime };
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !runtime) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await desktopSession?.cookies.flushStore();
      desktopSession?.flushStorageData();
      await runtime.close();
    } catch (error) {
      console.error(error);
    } finally {
      app.quit();
    }
  })();
});
process.once("SIGTERM", () => app.quit());
process.once("SIGINT", () => app.quit());

if (app.requestSingleInstanceLock()) {
  module.exports.ready = start();
  module.exports.ready.catch(showError);
} else {
  app.quit();
}
