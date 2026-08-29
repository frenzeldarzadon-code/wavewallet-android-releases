import { describe, expect, it } from "vitest";
import {
  cachedStatuses,
  forgetStatuses,
  rememberStatuses,
} from "./omada-status-cache.server";

describe("omada voucher status memo", () => {
  it("answers a repeat read for the same codes", () => {
    rememberStatuses("shop-a", { ABC123: "in_use", DEF456: "unused" });
    expect(cachedStatuses("shop-a", ["ABC123", "DEF456"])).toEqual({
      ABC123: "in_use",
      DEF456: "unused",
    });
  });

  it("misses when any requested code is unknown", () => {
    rememberStatuses("shop-b", { ABC123: "in_use" });
    expect(cachedStatuses("shop-b", ["ABC123", "NEW999"])).toBeNull();
  });

  it("never leaks another shop's snapshot", () => {
    rememberStatuses("shop-c", { ABC123: "in_use" });
    expect(cachedStatuses("shop-d", ["ABC123"])).toBeNull();
  });

  it("forgets a shop after an import", () => {
    rememberStatuses("shop-e", { ABC123: "in_use" });
    forgetStatuses("shop-e");
    expect(cachedStatuses("shop-e", ["ABC123"])).toBeNull();
  });
});
