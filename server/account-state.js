import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { gitlabProjectList } from "./gitlab.js";
import { createDemo } from "./demo.js";

/** @param {string} dataDir */
export async function openAccountState(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(dataDir, "state.json");
  /** @type {import('./types.js').SavedState} */
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot read saved course data.");
  }
  // Demo fixtures are regenerated for the current UI schema on every launch.
  const demo = createDemo();
  state ??= { accounts: {}, demo };
  state.demo = demo;
  state.accounts = Object.assign(Object.create(null), state.accounts);
  for (const account of Object.values(state.accounts)) {
    account.gitlabProjects = Object.fromEntries(Object.entries(account.gitlabProjects ?? {})
      .map(([courseId, projects]) => [courseId, gitlabProjectList(projects)]));
  }
  let queue = Promise.resolve();
  function save() {
    const json = JSON.stringify(state);
    queue = queue.catch(() => {}).then(async () => {
      await writeFile(`${statePath}.tmp`, json, { mode: 0o600 });
      await rename(`${statePath}.tmp`, statePath);
    });
    return queue;
  }
  return { state, save, close: () => queue };
}
