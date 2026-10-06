import { startServer } from "./runtime.js";

const isDev = process.argv.includes("--dev");
const runtime = await startServer({
  isDev,
  port: Number(process.env.PORT || 5173),
  host: process.env.HOST || (isDev ? "0.0.0.0" : "127.0.0.1"),
});
console.log(`Campus is ready at ${runtime.url}`);
if (runtime.host === "0.0.0.0") {
  console.log(`LAN access is enabled on port ${runtime.port}`);
}
async function shutdown() {
  await runtime.close();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
