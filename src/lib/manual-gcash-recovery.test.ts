import { describe, expect, it } from "vitest";
import { validateManualRecovery, type ManualRecoveryInput } from "./manual-gcash-recovery";

const base: ManualRecoveryInput = {
  amountPhp: 1000,
  reference: "9044057598177",
  receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  receivingNumber: "09171234567",
  senderNumber: "+639752505196",
  senderName: "DO**A RO**F B.",
};

describe("manual GCash recovery validation", () => {
  it("accepts the missed PHP 1,000 payment", () => {
    expect(validateManualRecovery(base)).toBeNull();
  });

  it("requires a positive amount", () => {
    expect(validateManualRecovery({ ...base, amountPhp: 0 })).toMatch(/greater than zero/);
    expect(validateManualRecovery({ ...base, amountPhp: -5 })).toMatch(/greater than zero/);
  });

  it("requires a GCash reference", () => {
    expect(validateManualRecovery({ ...base, reference: "  " })).toMatch(/reference/);
  });

  it("requires a readable date and time", () => {
    expect(validateManualRecovery({ ...base, receivedAt: "not a date" })).toMatch(/date and time/);
  });

  it("rejects a future payment time", () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    expect(validateManualRecovery({ ...base, receivedAt: future })).toMatch(/future/);
  });

  it("requires a receiving GCash number", () => {
    expect(validateManualRecovery({ ...base, receivingNumber: "" })).toMatch(/receiving GCash/);
  });

  it("rejects an unusable sender number but allows an unknown one", () => {
    expect(validateManualRecovery({ ...base, senderNumber: "abc" })).toMatch(/sender number/);
    expect(validateManualRecovery({ ...base, senderNumber: "" })).toBeNull();
  });
});
