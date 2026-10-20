import session from "express-session";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

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
      const envelope = JSON.parse(
        await readFile(path.join(directory, "sessions.enc"), "utf8"),
      );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      entries = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(envelope.data, "base64")),
          decipher.final(),
        ]).toString(),
      );
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
      .then(async () => {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const data = Buffer.concat([
          cipher.update(text, "utf8"),
          cipher.final(),
        ]);
        const envelope = JSON.stringify({
          v: 1,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: data.toString("base64"),
        });
        const target = path.join(this.directory, "sessions.enc");
        await writeFile(`${target}.tmp`, envelope, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
      });
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
