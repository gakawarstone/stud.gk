import { hkdfSync } from "node:crypto";
import path from "node:path";
import { readEncryptedJson, writeEncryptedJson } from "./encrypted-json.js";

/** @param {string} directory @param {import('./sessions.js').EncryptedSessionStore} sessions */
export async function openGitlabTokens(directory, sessions) {
  const filename = path.join(directory, "gitlab-tokens.enc");
  const key = Buffer.from(hkdfSync("sha256", sessions.key, "campus", "gitlab-account-tokens", 32));
  /** @type {Record<string, Record<string, string>>} */
  let accounts = {};
  try {
    accounts = await readEncryptedJson(filename, key);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot decrypt saved GitLab tokens.");
  }
  /** @param {string} userId */
  const tokensFor = (userId) => Object.hasOwn(accounts, userId) ? accounts[userId] : {};
  /** @param {Record<string, Record<string, string>>} next */
  const persist = (next) => writeEncryptedJson(filename, key, JSON.stringify(next));

  // Import before the session middleware can expire or regenerate old sessions.
  // If sessions disagree, the most recent login wins. Existing account tokens win
  // over every legacy copy, so migration cannot undo a replacement.
  const legacy = Object.values(sessions.entries).filter((entry) => entry.value.gitlabTokens);
  const savedAccounts = accounts;
  for (const { value } of legacy.sort((a, b) => (a.value.auth?.expiresAt ?? 0) - (b.value.auth?.expiresAt ?? 0))) {
    const userId = value.auth?.user?.id;
    if (typeof userId !== "string") continue;
    const saved = Object.hasOwn(savedAccounts, userId) ? savedAccounts[userId] : {};
    const tokens = { ...tokensFor(userId) };
    for (const [origin, token] of Object.entries(value.gitlabTokens))
      if (!Object.hasOwn(saved, origin)) tokens[origin] = token;
    accounts = { ...accounts, [userId]: tokens };
  }
  if (legacy.length) {
    // Commit the separate file before removing the only legacy copies.
    await persist(accounts);
    for (const { value } of legacy) delete value.gitlabTokens;
    await sessions.persist();
  }

  let queue = Promise.resolve();
  return {
    /** @param {string} userId @param {string} origin */
    get(userId, origin) {
      const tokens = tokensFor(userId);
      return Object.hasOwn(tokens, origin) ? tokens[origin] : undefined;
    },
    /** @param {string} userId @param {string} origin @param {string | null} token */
    set(userId, origin, token) {
      queue = queue.catch(() => {}).then(async () => {
        const tokens = { ...tokensFor(userId), [origin]: token };
        if (token === null) delete tokens[origin];
        const next = { ...accounts, [userId]: tokens };
        if (!Object.keys(tokens).length) delete next[userId];
        await persist(next);
        accounts = next;
      });
      return queue;
    },
    close: () => queue,
  };
}
