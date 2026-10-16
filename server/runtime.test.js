import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "./runtime.js";

test("desktop server binds to loopback, serves its API and closes its port", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "campus-runtime-"));
  await writeFile(path.join(dataDir, "state.json"), JSON.stringify({
    accounts: {}, demo: { courses: [], resources: [], changes: [] },
  }));
  const runtime = await startServer({ dataDir, autoSync: false });
  try {
    assert.equal(runtime.server.address().address, "127.0.0.1");
    assert.ok(runtime.port > 0);
    const state = await fetch(`${runtime.url}/api/state`).then((response) => response.json());
    assert.equal(state.authenticated, false);
    const demo = await fetch(`${runtime.url}/api/demo`).then((response) => response.json());
    assert.ok(demo.courses.length > 0);
    for (const kind of ["file", "news", "schedule", "course"]) {
      assert.ok(demo.resources.some((resource) => resource.kind === kind), `Restored demo includes ${kind}`);
    }
    // A saved desktop port that is occupied must produce a recoverable error.
    await assert.rejects(
      startServer({ dataDir: path.join(dataDir, "other"), port: runtime.port, autoSync: false }),
      { code: "EADDRINUSE" },
    );
    await runtime.close();
    await assert.rejects(fetch(`${runtime.url}/api/state`));
    await runtime.close();
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
