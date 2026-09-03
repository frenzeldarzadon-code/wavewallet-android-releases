import { describe, expect, it } from "vitest";
import { NEW_MEMBER_DESTINATION } from "@/lib/shop-routing";
import { landingForMemberships, MY_SHOPS_PATH } from "@/lib/session";

describe("landing after sign-in", () => {
  it("keeps members with no shop in the Universe", () => {
    expect(NEW_MEMBER_DESTINATION).toBe("/universe");
    expect(landingForMemberships([])).toEqual({
      to: NEW_MEMBER_DESTINATION,
      switchTo: null,
    });
  });

  it("opens the only shop, switching to it when needed", () => {
    expect(
      landingForMemberships([{ ecosystemId: "a", role: "customer", isActive: false }]),
    ).toEqual({ to: "/app/shop", switchTo: "a" });
    expect(landingForMemberships([{ ecosystemId: "a", role: "admin", isActive: true }])).toEqual({
      to: "/admin",
      switchTo: null,
    });
  });

  it("opens the last-used shop when several exist", () => {
    expect(
      landingForMemberships([
        { ecosystemId: "a", role: "customer", isActive: false },
        { ecosystemId: "b", role: "reseller", isActive: true },
      ]),
    ).toEqual({ to: "/reseller/shop", switchTo: null });
  });

  it("shows My Shops when several shops exist and none was used", () => {
    expect(
      landingForMemberships([
        { ecosystemId: "a", role: "customer", isActive: false },
        { ecosystemId: "b", role: "customer", isActive: false },
      ]),
    ).toEqual({ to: MY_SHOPS_PATH, switchTo: null });
  });
});
