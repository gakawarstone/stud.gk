import { createHash, randomUUID } from "node:crypto";

function fingerprint(item) {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}
const sourceKey = (item) => JSON.stringify([item.courseId, item.kind]);

/** @param {import('../shared/studip.js').AccountState | undefined} previous @param {import('../shared/studip.js').Snapshot} snapshot @param {string} now @returns {import('../shared/studip.js').AccountState} */
export function reconcile(previous, snapshot, now = new Date().toISOString()) {
  const old = new Map(
    (previous?.resources ?? []).map((item) => [item.id, item]),
  );
  const next = new Map(snapshot.resources.map((item) => [item.id, item]));
  const unavailable = new Set(
    (snapshot.unavailableSources ?? []).map(sourceKey),
  );
  const recovering = new Set(
    (previous?.unavailableSources ?? []).map(sourceKey),
  );
  // Missing permissions are not evidence of deletion. Keep the last known data.
  for (const item of old.values()) {
    if (unavailable.has(sourceKey(item))) next.set(item.id, item);
  }
  /** @type {import('../shared/studip.js').Change[]} */
  const changes = [];
  // First sync establishes a baseline. Existing material is not reported as new.
  if (previous) {
    for (const item of next.values()) {
      // Newly readable sections need a baseline after a gap in visibility.
      if (recovering.has(sourceKey(item))) continue;
      const before = old.get(item.id);
      if (!before || fingerprint(item) !== fingerprint(before)) {
        changes.push({
          ...item,
          id: randomUUID(),
          resourceId: item.id,
          action: before ? "updated" : "added",
          occurredAt: now,
          read: false,
          starred: false,
          ...(before ? { before } : {}),
        });
      }
    }
    for (const item of old.values()) {
      if (!next.has(item.id) && !recovering.has(sourceKey(item)))
        changes.push({
          ...item,
          id: randomUUID(),
          resourceId: item.id,
          action: "removed",
          occurredAt: now,
          read: false,
          starred: false,
        });
    }
  }
  return {
    ...snapshot,
    resources: [...next.values()],
    changes: [...changes, ...(previous?.changes ?? [])].slice(0, 2000),
    lastSync: now,
  };
}
