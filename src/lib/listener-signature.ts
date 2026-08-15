/**
 * Signing scheme for the GCash notification listener companion app.
 *
 * The phone is paired once with a pairing secret that is shown a single time.
 * The HMAC key is SHA-256(pairing secret) — the device derives it locally and
 * the server stores only that derived key, so the human-readable pairing code
 * itself is never persisted. No Supabase key or service credential ever leaves
 * the server.
 */
const encoder = new TextEncoder();

export const LISTENER_MAX_SKEW_SECONDS = 300;

export function signingPayload(deviceId: string, timestamp: string, nonce: string, body: string) {
  return `${deviceId}.${timestamp}.${nonce}.${body}`;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(key: string, message: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function timestampWithinSkew(timestamp: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return false;
  return Math.abs(nowSeconds - value) <= LISTENER_MAX_SKEW_SECONDS;
}

/** Reference implementation of what the Android app sends. */
export async function signListenerRequest(opts: {
  deviceId: string;
  hmacKey: string;
  body: string;
  timestamp?: string;
  nonce?: string;
}) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? crypto.randomUUID();
  const signature = await hmacHex(opts.hmacKey, signingPayload(opts.deviceId, timestamp, nonce, opts.body));
  return { timestamp, nonce, signature };
}
