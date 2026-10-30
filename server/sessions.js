import session from "express-session";
import { randomBytes, hkdfSync } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readEncryptedJson, writeEncryptedJson } from "./encrypted-json.js";

export const SESSION_NAME = "campus.sid";
export const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

// Local single-process store. Only an encrypted envelope is written to disk.
export class EncryptedSessionStore extends session.Store {
  constructor(directory, key, entries = {}, now = Date.now) {
    super();
    this.directory = directory;
    this.key = key;
    this.entries = entries;
    this.now = now;
    this.queue = Promise.resolve();
  }
  static async open(directory, now = Date.now) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const keyPath = path.join(directory, "session.key");
    let key;
    try {
      key = await readFile(keyPath);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      key = randomBytes(32);
      await writeFile(keyPath, key, { mode: 0o600, flag: "wx" });
    }
    if (key.length !== 32)
      throw new Error("Invalid local session encryption key.");
    await chmod(keyPath, 0o600);
    let entries = {};
    try {
      entries = await readEncryptedJson(path.join(directory, "sessions.enc"), key);
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error(
          "Cannot decrypt local sessions. No sessions were loaded.",
        );
    }
    return new EncryptedSessionStore(directory, key, entries, now);
  }
  get secret() {
    return Buffer.from(
      hkdfSync("sha256", this.key, "campus", "session-cookie-signing", 32),
    ).toString("base64");
  }
  expires(value) {
    return Math.min(
      value.auth?.expiresAt || Infinity,
      value.cookie?.expires
        ? Date.parse(value.cookie.expires)
        : this.now() + SESSION_LIFETIME,
    );
  }
  persist() {
    const text = JSON.stringify(this.entries);
    this.queue = this.queue
      .catch(() => {})
      .then(() => writeEncryptedJson(path.join(this.directory, "sessions.enc"), this.key, text));
    return this.queue;
  }
  get(id, callback) {
    const entry = this.entries[id];
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) {
        delete this.entries[id];
        this.persist().catch(() => {});
      }
      return callback(null, null);
    }
    callback(null, JSON.parse(JSON.stringify(entry.value)));
  }
  /** @param {string} id @param {import('express-session').SessionData} value @param {(error?: Error | null) => void} callback */
  set(id, value, callback = () => {}) {
    const clone = JSON.parse(JSON.stringify(value));
    this.entries[id] = { value: clone, expiresAt: this.expires(clone) };
    this.persist().then(() => callback(null), callback);
  }
  /** @param {string} id @param {(error?: Error | null) => void} callback */
  destroy(id, callback = () => {}) {
    delete this.entries[id];
    this.persist().then(() => callback(null), callback);
  }
  /** @param {string} id @param {import('express-session').SessionData} value @param {(error?: Error | null) => void} callback */
  touch(id, value, callback = () => {}) {
    const entry = this.entries[id];
    if (!entry) return callback(null);
    entry.value.cookie = JSON.parse(JSON.stringify(value.cookie));
    entry.expiresAt = this.expires(entry.value);
    this.persist().then(() => callback(null), callback);
  }
  all(callback) {
    const entries = Object.entries(this.entries).filter(
      ([, entry]) => entry.expiresAt > this.now(),
    );
    callback(
      null,
      Object.fromEntries(
        entries.map(([id, entry]) => [
          id,
          JSON.parse(JSON.stringify(entry.value)),
        ]),
      ),
    );
  }
}
