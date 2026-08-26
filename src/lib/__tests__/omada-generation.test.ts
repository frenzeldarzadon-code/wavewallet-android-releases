import { describe, expect, it } from "vitest";
import {
  controllerMismatch,
  defaultGenerationValues,
  defaultGroupName,
  isValidVoucherCode,
  reviewExtractedCodes,
  validateGenerationPayload,
} from "../omada-generation";

describe("omada generation template", () => {
  it("accepts the verified default payload", () => {
    expect(validateGenerationPayload({ ...defaultGenerationValues(), name: "Test" })).toEqual([]);
  });

  it("rejects quantities outside the controller's verified range", () => {
    const payload = { ...defaultGenerationValues(), name: "Test", amount: 6000 };
    expect(validateGenerationPayload(payload).join(" ")).toMatch(/amount/i);
  });

  it("rejects a code length the controller does not allow", () => {
    const payload = { ...defaultGenerationValues(), name: "Test", codeLength: 12 };
    expect(validateGenerationPayload(payload).length).toBeGreaterThan(0);
  });

  it("requires every verified mandatory field", () => {
    expect(validateGenerationPayload({ name: "Test" }).length).toBeGreaterThan(0);
  });
});

describe("group naming", () => {
  it("uses product title plus today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(defaultGroupName("1 Day", [])).toBe(`1 Day ${today}`);
  });

  it("avoids confusing duplicates on the same day", () => {
    const today = new Date().toISOString().slice(0, 10);
    const first = `1 Day ${today}`;
    expect(defaultGroupName("1 Day", [first])).toBe(`${first} (2)`);
  });
});

describe("controller change safety", () => {
  const current = {
    baseUrl: "https://portal.example.com",
    omadacId: "abc",
    siteId: "site1",
    controllerVersion: "6.2.14.11",
  };

  it("stays quiet when the controller is unchanged", () => {
    expect(controllerMismatch(current, current)).toBeNull();
  });

  it("warns when the calibration came from another controller or version", () => {
    expect(controllerMismatch({ ...current, siteId: "other" }, current)).toBeTruthy();
    expect(controllerMismatch({ ...current, controllerVersion: "5.9.9" }, current)).toBeTruthy();
  });
});

describe("code review before import", () => {
  it("counts duplicates in the batch and in existing inventory", () => {
    const summary = reviewExtractedCodes(["11111111", "11111111", "22222222"], ["22222222"]);
    expect(summary.extracted).toBe(3);
    expect(summary.duplicateInBatch).toBe(1);
    expect(summary.duplicateInInventory).toBe(1);
    expect(summary.importable).toEqual(["11111111"]);
  });

  it("flags codes that do not match the expected format", () => {
    const summary = reviewExtractedCodes(["1234"], [], 8);
    expect(summary.invalid).toBe(1);
    expect(summary.importable).toEqual([]);
  });

  it("validates code format and length", () => {
    expect(isValidVoucherCode("15918788", 8)).toBe(true);
    expect(isValidVoucherCode("159-187", 8)).toBe(false);
  });
});
