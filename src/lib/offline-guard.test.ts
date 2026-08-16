import { describe, expect, it, afterEach } from "vitest";
import { OFFLINE_TRANSACTION_MESSAGE, isOffline, requireOnline } from "./offline-guard";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

afterEach(() => setOnline(true));

describe("offline guard", () => {
  it("treats a connected browser as online", () => {
    setOnline(true);
    expect(isOffline()).toBe(false);
    expect(() => requireOnline()).not.toThrow();
  });

  it("blocks financial writes while offline", () => {
    setOnline(false);
    expect(isOffline()).toBe(true);
    expect(() => requireOnline()).toThrow(OFFLINE_TRANSACTION_MESSAGE);
  });

  it("never queues the refused action", () => {
    setOnline(false);
    let attempts = 0;
    const attempt = () => {
      requireOnline();
      attempts += 1;
    };
    expect(attempt).toThrow();
    setOnline(true);
    // Coming back online must not replay anything on its own.
    expect(attempts).toBe(0);
    attempt();
    expect(attempts).toBe(1);
  });
});
