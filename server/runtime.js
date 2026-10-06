import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// The CLI and Electron share the same API and static assets.
export async function startServer({
  root = projectRoot,
  dataDir = path.join(root, ".data"),
  isDev = false,
  port = 0,
  host = "127.0.0.1",
  ...appOptions
} = {}) {
  const { app, close: closeApp } = await createApp({ dataDir, ...appOptions });
  let vite;
  let server;
  try {
    for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      app.use(
        `/pdf-assets/${directory}`,
        express.static(path.join(root, "node_modules/pdfjs-dist", directory)),
      );
    }
    if (isDev) {
      const { createServer } = await import("vite");
      vite = await createServer({
        root,
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(path.join(root, "dist")));
      app.get("/{*path}", (req, res) =>
        res.sendFile(path.join(root, "dist/index.html")),
      );
    }
    server = app.listen(port, host);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    await vite?.close();
    await closeApp();
    throw error;
  }
  const actualPort = server.address().port;
  let closing;
  return {
    app,
    server,
    host,
    port: actualPort,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`,
    close() {
      closing ??= (async () => {
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
        await vite?.close();
        await closeApp();
      })();
      return closing;
    },
  };
}
