import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const { app, close } = await createApp({ dataDir: path.join(root, ".data") });
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  app.use(
    `/pdf-assets/${directory}`,
    express.static(path.join(root, "node_modules/pdfjs-dist", directory)),
  );
}
let vite;
const isDev = process.argv.includes("--dev");
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
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || (isDev ? "0.0.0.0" : "127.0.0.1");
const server = app.listen(port, host, () => {
  console.log(`Campus is ready at http://localhost:${port}`);
  if (host === "0.0.0.0") {
    console.log(`LAN access is enabled on port ${port}`);
  }
});
async function shutdown() {
  server.close();
  await vite?.close();
  await close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
