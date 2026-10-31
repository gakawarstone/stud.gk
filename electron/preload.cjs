const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studGkDesktop", {
  chooseProjectDirectory: () => ipcRenderer.invoke("idea:choose-directory"),
  openIdeaProject: (directory) => ipcRenderer.invoke("idea:open-project", directory),
});
