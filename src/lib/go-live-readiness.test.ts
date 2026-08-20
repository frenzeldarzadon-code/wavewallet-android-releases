import { describe, expect, it } from "vitest";
import {
  goLiveChecklist,
  goLiveFieldErrors,
  mapGoLiveError,
  normalizeSenderNumber,
} from "@/lib/go-live-readiness";

const ready = {
  shopName: "Sagada Wave WiFi",
  shopKind: "subscription",
  planId: "plan-1",
  months: 1,
  payerNumber: "09171234567",
  reference: "1234567890123",
  platformGcashNumber: "09170000000",
  hasPendingRequest: false,
  proofPath: "user-id/receipt.jpg",
};

describe("go live readiness", () => {
  it("normalises PH mobile numbers", () => {
    expect(normalizeSenderNumber("0917 123 4567")).toBe("639171234567");
    expect(normalizeSenderNumber("639171234567")).toBe("639171234567");
    expect(normalizeSenderNumber("12345")).toBeNull();
  });

  it("reports nothing missing when everything is filled in", () => {
    expect(goLiveChecklist(ready)).toEqual([]);
    expect(goLiveFieldErrors(ready)).toEqual({});
  });

  it("names each missing field with a place to fix it", () => {
    const items = goLiveChecklist({
      ...ready,
      planId: "",
      payerNumber: "",
      reference: "",
    });
    expect(items.map((i) => i.id)).toEqual(["plan", "payerNumber", "reference"]);
  });

  it("requires the payment screenshot, like Cash In", () => {
    const items = goLiveChecklist({ ...ready, proofPath: null });
    expect(items.map((i) => i.id)).toEqual(["proof"]);
    expect(goLiveFieldErrors({ ...ready, proofPath: null }).proof).toMatch(/screenshot/);
    expect(mapGoLiveError("A payment screenshot is required").field).toBe("proof");
    expect(items.every((i) => i.fieldId && i.how.length > 10)).toBe(true);
  });

  it("flags platform-side blockers the operator cannot fix", () => {
    const items = goLiveChecklist({ ...ready, platformGcashNumber: null });
    expect(items[0]?.id).toBe("platform-gcash");
    expect(items[0]?.blocking).toBe(true);
  });

  it("flags a pending payment instead of allowing a second one", () => {
    expect(goLiveChecklist({ ...ready, hasPendingRequest: true })[0]?.id).toBe("pending");
  });

  it("points a missing shop name at shop settings", () => {
    expect(goLiveChecklist({ ...ready, shopName: "  " })[0]?.to).toBe("/admin/settings");
  });

  it("rejects out-of-range months and malformed numbers", () => {
    const e = goLiveFieldErrors({ ...ready, months: 30, payerNumber: "abc", reference: "12" });
    expect(e.months).toMatch(/1 and 24/);
    expect(e.payerNumber).toMatch(/09XXXXXXXXX/);
    expect(e.reference).toMatch(/longer/);
  });

  it("maps backend refusals to a field and a readable explanation", () => {
    const dup = mapGoLiveError(
      "That GCash reference was already used for another payment. Each reference can only be used once.",
    );
    expect(dup.field).toBe("reference");
    expect(dup.message).toMatch(/already been used/);
    expect(mapGoLiveError("Months must be between 1 and 24").field).toBe("months");
    expect(mapGoLiveError("A payment for this shop is already awaiting verification").field).toBeUndefined();
  });
});
