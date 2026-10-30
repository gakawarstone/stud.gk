import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";

/** @param {string} filename @param {Buffer} key */
export async function readEncryptedJson(filename, key) {
  const envelope = JSON.parse(await readFile(filename, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")), decipher.final(),
  ]).toString());
}

// Callers must serialize writes to the same filename.
/** @param {string} filename @param {Buffer} key @param {string} json */
export async function writeEncryptedJson(filename, key, json) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const envelope = JSON.stringify({
    v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"),
  });
  await writeFile(`${filename}.tmp`, envelope, { mode: 0o600 });
  await rename(`${filename}.tmp`, filename);
}
