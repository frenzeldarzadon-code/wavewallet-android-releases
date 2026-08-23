import { describe, expect, it } from "vitest";
import { goLiveControlsVisible } from "./go-live";

describe("Renew / Extend / Change plan availability", () => {
  it("stays available on a live shop even while a payment waits for verification", () => {
    expect(goLiveControlsVisible({ status: "pending" }, true)).toBe(true);
  });

  it("is available on a live shop with no request at all", () => {
    expect(goLiveControlsVisible(null, true)).toBe(true);
  });

  it("waits for the submitted payment on a demo shop that is not live yet", () => {
    expect(goLiveControlsVisible({ status: "pending" }, false)).toBe(false);
  });

  it("returns to the demo shop once the payment is decided or withdrawn", () => {
    expect(goLiveControlsVisible({ status: "rejected" }, false)).toBe(true);
    expect(goLiveControlsVisible({ status: "approved" }, false)).toBe(true);
  });
});
