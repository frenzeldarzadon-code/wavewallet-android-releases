/**
 * Server-only encryption for tenant Omada client secrets.
 *
 * Each shop's Omada Client Secret is stored as ciphertext, so it is unreadable
 * both in the browser and to anyone browsing the database. The key material
 * lives only in the server environment (OMADA_CREDENTIAL_KEY).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env["OMADA_CREDENTIAL_KEY"];
  if (!raw) throw new Error("OMADA_CREDENTIAL_KEY is not configured on the server");
  // The stored secret is a random printable string; derive a fixed 32-byte key.
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
