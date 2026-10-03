import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const { app, close } = await createApp({ dataDir: path.join(root, ".data") });
let vite;
if (process.argv.includes("--dev")) {
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
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Campus is ready at http://localhost:${port}`),
);
async function shutdown() {
  server.close();
  await vite?.close();
  await close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
