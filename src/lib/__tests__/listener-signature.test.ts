import { describe, expect, it } from "vitest";
import {
  hmacHex,
  sha256Hex,
  signListenerRequest,
  signingPayload,
  timestampWithinSkew,
  timingSafeEqualHex,
} from "@/lib/listener-signature";

const pairingSecret = "a".repeat(48);

describe("listener request signing", () => {
  it("derives the HMAC key from the pairing secret, never storing it verbatim", async () => {
    const key = await sha256Hex(pairingSecret);
    expect(key).toHaveLength(64);
    expect(key).not.toContain(pairingSecret);
  });

  it("verifies a correctly signed request", async () => {
    const key = await sha256Hex(pairingSecret);
    const body = JSON.stringify({ kind: "event", amount_php: 500 });
    const { timestamp, nonce, signature } = await signListenerRequest({
      deviceId: "device-1",
      hmacKey: key,
      body,
    });
    const expected = await hmacHex(key, signingPayload("device-1", timestamp, nonce, body));
    expect(timingSafeEqualHex(expected, signature)).toBe(true);
  });

  it("rejects a tampered body, a wrong key and a wrong device", async () => {
    const key = await sha256Hex(pairingSecret);
    const body = JSON.stringify({ kind: "event", amount_php: 500 });
    const { timestamp, nonce, signature } = await signListenerRequest({
      deviceId: "device-1",
      hmacKey: key,
      body,
    });

    const tampered = await hmacHex(
      key,
      signingPayload("device-1", timestamp, nonce, JSON.stringify({ kind: "event", amount_php: 5000 })),
    );
    expect(timingSafeEqualHex(tampered, signature)).toBe(false);

    const otherKey = await hmacHex(await sha256Hex("b".repeat(48)), signingPayload("device-1", timestamp, nonce, body));
    expect(timingSafeEqualHex(otherKey, signature)).toBe(false);

    const otherDevice = await hmacHex(key, signingPayload("device-2", timestamp, nonce, body));
    expect(timingSafeEqualHex(otherDevice, signature)).toBe(false);
  });

  it("refuses stale or unreadable timestamps", () => {
    const now = 1_800_000_000;
    expect(timestampWithinSkew(String(now), now)).toBe(true);
    expect(timestampWithinSkew(String(now - 120), now)).toBe(true);
    expect(timestampWithinSkew(String(now - 3600), now)).toBe(false);
    expect(timestampWithinSkew(String(now + 3600), now)).toBe(false);
    expect(timestampWithinSkew("not-a-number", now)).toBe(false);
  });
});
