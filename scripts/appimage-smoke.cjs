// Launch the actual AppImage with an isolated profile and inspect its renderer.
// No repository server, development assets or system profile are used.
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  assert.ok(process.argv[2], "Usage: node scripts/appimage-smoke.cjs path/to.AppImage");
  const profile = await mkdtemp(path.join(tmpdir(), "stud-gk-appimage-"));
  const env = { ...process.env, XDG_CONFIG_HOME: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    path.resolve(process.argv[2]),
    ["--appimage-extract-and-run", "--no-sandbox", "--ozone-platform=x11", "--remote-debugging-port=0"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    socket,
    timer;
  try {
    const address = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`AppImage startup timed out: ${output}`)), 30000);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`AppImage exited ${code}: ${output}`)));
      const read = (data) => {
        output += data.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
    });
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let nextId = 1;
    const requests = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const pending = requests.get(message.id);
      if (pending) {
        requests.delete(message.id);
        clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      }
    };
    function send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          requests.delete(id);
          reject(new Error(`CDP timed out: ${method}`));
        }, 10000);
        requests.set(id, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    }
    let target;
    for (let i = 0; i < 100; i++) {
      target = (await send("Target.getTargets")).targetInfos.find(
        (t) => t.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(t.url),
      );
      if (target) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(target, "Packaged local server opens its renderer");
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await evaluate(
      `(async()=>{while(!document.querySelector('.demo-link')) await new Promise(r=>setTimeout(r,25));document.querySelector('.demo-link').click();while(!document.querySelector('.course-card')) await new Promise(r=>setTimeout(r,25));})()`,
    );
    assert.equal(await evaluate("document.querySelectorAll('.course-card').length"), 4);
    await evaluate("document.querySelector('.course-card-link').click()");
    await evaluate(
      `(async()=>{while(!document.querySelector('.course-heading')) await new Promise(r=>setTimeout(r,25));})()`,
    );
    assert.ok(await evaluate("!!document.querySelector('.file-card')"));
    assert.equal(await evaluate("typeof require"), "undefined");
    // Closing the real renderer window exercises Electron's normal quit path.
    // Observe executable exit; its CDP session disappears with the window.
    const exited = new Promise((resolve, reject) => {
      if (child.exitCode !== null) return resolve(child.exitCode);
      const deadline = setTimeout(() => reject(new Error("AppImage did not exit")), 10000);
      child.once("exit", (code) => {
        clearTimeout(deadline);
        resolve(code);
      });
    });
    socket.send(
      JSON.stringify({
        id: nextId++,
        method: "Runtime.evaluate",
        params: { expression: "window.close()" },
        sessionId,
      }),
    );
    assert.equal(await exited, 0, "Packaged executable exits cleanly");
    console.log(
      JSON.stringify({
        result: "passed",
        appImage: path.basename(process.argv[2]),
        url: target.url,
        checks:
          "actual AppImage executable, isolated profile, packaged server/assets, demo/course navigation, sandboxed renderer",
      }),
    );
  } finally {
    clearTimeout(timer);
    socket?.close();
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    await rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
