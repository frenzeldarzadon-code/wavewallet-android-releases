/**
 * Web Push sender (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID).
 *
 * Built on WebCrypto only, so it runs in the edge Worker where the Node
 * `web-push` package cannot. Nothing here touches the database: it takes one
 * browser subscription and one small JSON payload, and reports what the push
 * service answered.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidConfig {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar (JWK "d")
  subject: string; // https: or mailto: contact
}

export type PushSendResult =
  | { outcome: "sent"; status: number }
  | { outcome: "gone"; status: number } // subscription no longer valid
  | { outcome: "retry"; status: number; reason: string } // transient
  | { outcome: "failed"; status: number; reason: string }; // permanent for this payload

const enc = new TextEncoder();

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** Encrypts `plaintext` for one subscription. Returns the aes128gcm body. */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = base64UrlDecode(sub.p256dh);
  const authSecret = base64UrlDecode(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Invalid p256dh key");
  if (authSecret.length !== 16) throw new Error("Invalid auth secret");

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const recordSize = 4096;
  if (plaintext.length + 1 > recordSize - 16) throw new Error("Payload too large");
  const padded = concat(plaintext, Uint8Array.of(2)); // single (last) record delimiter
  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      padded as BufferSource,
    ),
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** VAPID `Authorization` header for one push-service origin. */
export async function vapidAuthorization(vapid: VapidConfig, audience: string): Promise<string> {
  const pub = base64UrlDecode(vapid.publicKey);
  if (pub.length !== 65) throw new Error("Invalid VAPID public key");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(pub.slice(1, 33)),
    y: base64UrlEncode(pub.slice(33, 65)),
    d: vapid.privateKey,
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput),
  );
  return `vapid t=${signingInput}.${base64UrlEncode(sig)}, k=${vapid.publicKey}`;
}

export function classifyPushResponse(status: number, bodyText: string): PushSendResult {
  if (status === 200 || status === 201 || status === 202) return { outcome: "sent", status };
  if (status === 404 || status === 410) return { outcome: "gone", status };
  const reason = `${status} ${bodyText.slice(0, 120)}`.trim();
  if (status === 429 || status >= 500) return { outcome: "retry", status, reason };
  return { outcome: "failed", status, reason };
}

export interface SendOptions {
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string; // collapses older pending pushes with the same topic
  fetchImpl?: typeof fetch;
}

export async function sendWebPush(
  sub: PushSubscriptionKeys,
  vapid: VapidConfig,
  payload: string,
  opts: SendOptions = {},
): Promise<PushSendResult> {
  let audience: string;
  try {
    audience = new URL(sub.endpoint).origin;
  } catch {
    return { outcome: "gone", status: 0 };
  }
  const body = await encryptPayload(sub, enc.encode(payload));
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-encoding": "aes128gcm",
    ttl: String(opts.ttlSeconds ?? 24 * 60 * 60),
    urgency: opts.urgency ?? "normal",
    authorization: await vapidAuthorization(vapid, audience),
  };
  if (opts.topic) headers["topic"] = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(sub.endpoint, { method: "POST", headers, body: body as BufferSource });
    const text = res.ok ? "" : await res.text().catch(() => "");
    return classifyPushResponse(res.status, text);
  } catch (e) {
    return { outcome: "retry", status: 0, reason: (e as Error).message.slice(0, 120) };
  }
}
