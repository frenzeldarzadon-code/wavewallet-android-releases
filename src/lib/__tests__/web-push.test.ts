import { describe, expect, it } from "vitest";
import { createECDH, createDecipheriv, createVerify, hkdfSync, generateKeyPairSync } from "node:crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  classifyPushResponse,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
} from "@/lib/web-push.server";
import { pushText } from "@/lib/push-text";

/** A browser-side subscription we can decrypt for, like a real phone would. */
function fakeSubscription() {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  return {
    ua,
    auth,
    p256dh: base64UrlEncode(ua.getPublicKey()),
    authB64: base64UrlEncode(auth),
  };
}

/** RFC 8291 receiver: decrypts an aes128gcm body with the subscription's keys. */
function decrypt(body: Uint8Array, sub: ReturnType<typeof fakeSubscription>): string {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const shared = sub.ua.computeSecret(Buffer.from(asPublic));
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    sub.ua.getPublicKey(),
    Buffer.from(asPublic),
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, sub.auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const tag = ciphertext.slice(ciphertext.length - 16);
  const data = ciphertext.slice(0, ciphertext.length - 16);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(Buffer.from(tag));
  const plain = Buffer.concat([d.update(Buffer.from(data)), d.final()]);
  // strip the single 0x02 delimiter (last record) and any zero padding
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end -= 1;
  expect(plain[end]).toBe(2);
  return plain.subarray(0, end).toString("utf8");
}

function vapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(pub.x!, "base64url"),
    Buffer.from(pub.y!, "base64url"),
  ]);
  return {
    config: { publicKey: base64UrlEncode(raw), privateKey: priv.d!, subject: "https://example.test" },
    publicKeyObject: publicKey,
  };
}

describe("web push payload encryption (RFC 8291)", () => {
  it("round-trips through a receiver holding the subscription keys", async () => {
    const sub = fakeSubscription();
    const body = await encryptPayload(
      { p256dh: sub.p256dh, auth: sub.authB64 },
      new TextEncoder().encode('{"title":"New private message"}'),
    );
    expect(decrypt(body, sub)).toBe('{"title":"New private message"}');
  });

  it("uses a fresh salt and key per message", async () => {
    const sub = fakeSubscription();
    const a = await encryptPayload({ p256dh: sub.p256dh, auth: sub.authB64 }, new Uint8Array([1]));
    const b = await encryptPayload({ p256dh: sub.p256dh, auth: sub.authB64 }, new Uint8Array([1]));
    expect(base64UrlEncode(a.slice(0, 16))).not.toBe(base64UrlEncode(b.slice(0, 16)));
  });

  it("rejects malformed subscription keys", async () => {
    await expect(encryptPayload({ p256dh: "AAAA", auth: "AAAA" }, new Uint8Array())).rejects.toThrow();
  });
});

describe("VAPID authorization (RFC 8292)", () => {
  it("signs a JWT the push service can verify with the public key", async () => {
    const { config, publicKeyObject } = vapidPair();
    const header = await vapidAuthorization(config, "https://fcm.googleapis.com");
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(config.publicKey);
    const [h, c, s] = m![1]!.split(".");
    const claims = JSON.parse(Buffer.from(base64UrlDecode(c!)).toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("https://example.test");
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    expect(claims.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600);
    const sig = Buffer.from(base64UrlDecode(s!));
    expect(sig.length).toBe(64);
    // Convert raw r||s to DER for node's verifier.
    const der = rawToDer(sig);
    const v = createVerify("SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKeyObject, der)).toBe(true);
  });
});

function rawToDer(sig: Buffer): Buffer {
  const trim = (b: Buffer) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i += 1;
    let out = b.subarray(i);
    if (out[0]! & 0x80) out = Buffer.concat([Buffer.from([0]), out]);
    return out;
  };
  const r = trim(sig.subarray(0, 32));
  const s = trim(sig.subarray(32));
  return Buffer.concat([
    Buffer.from([0x30, r.length + s.length + 4, 0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
}

describe("push service responses", () => {
  it("classifies sent / gone / retry / failed", () => {
    expect(classifyPushResponse(201, "").outcome).toBe("sent");
    expect(classifyPushResponse(410, "").outcome).toBe("gone");
    expect(classifyPushResponse(404, "").outcome).toBe("gone");
    expect(classifyPushResponse(429, "slow down").outcome).toBe("retry");
    expect(classifyPushResponse(503, "").outcome).toBe("retry");
    expect(classifyPushResponse(403, "bad vapid").outcome).toBe("failed");
    expect(classifyPushResponse(413, "").outcome).toBe("failed");
  });

  it("sends an encrypted aes128gcm request with VAPID headers", async () => {
    const sub = fakeSubscription();
    const { config } = vapidPair();
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init! };
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const result = await sendWebPush(
      { endpoint: "https://push.example/send/abc", p256dh: sub.p256dh, auth: sub.authB64 },
      config,
      JSON.stringify({ title: "Cash In update" }),
      { topic: "cash_in:/universe/wallet", fetchImpl },
    );
    expect(result.outcome).toBe("sent");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers["authorization"]).toMatch(/^vapid t=/);
    expect(headers["topic"]).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(decrypt(new Uint8Array(seen!.init.body as ArrayBuffer), sub)).toBe(
      JSON.stringify({ title: "Cash In update" }),
    );
  });

  it("treats a network error as retryable, and a bad endpoint as gone", async () => {
    const sub = fakeSubscription();
    const { config } = vapidPair();
    const failing = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await sendWebPush(
      { endpoint: "https://push.example/x", p256dh: sub.p256dh, auth: sub.authB64 },
      config,
      "{}",
      { fetchImpl: failing },
    );
    expect(r.outcome).toBe("retry");
    const g = await sendWebPush({ endpoint: "not a url", p256dh: sub.p256dh, auth: sub.authB64 }, config, "{}");
    expect(g.outcome).toBe("gone");
  });
});

describe("lock-screen text", () => {
  it("never carries amounts or message content", () => {
    const t = pushText({
      kind: "cashback",
      category: "financial",
      title: "Cashback received — 5.00 Coins",
      body: "From a voucher sale",
      link: "/universe/wallet",
    });
    expect(t.title).toBe("Cashback received");
    expect(t.body).not.toMatch(/5\.00/);
    const dm = pushText({
      kind: "dm_message",
      title: "New private message",
      body: "Ana sent you a message",
      link: "/universe/messages?thread=abc",
    });
    expect(dm.title).toBe("New private message");
    expect(dm.body).not.toMatch(/Ana/);
    expect(dm.tag).toBe("dm_message:/universe/messages");
    expect(pushText({ kind: "order_approved", title: "Order #12 approved", link: "/universe" }).title).toBe(
      "Order update",
    );
    expect(pushText({ kind: "unknown_thing", title: "Something 42 happened" }).title).not.toMatch(/42/);
  });
});
