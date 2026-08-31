import { describe, expect, it } from "vitest";
import {
  controllerMismatch,
  defaultGenerationValues,
  defaultGroupName,
  isValidVoucherCode,
  reviewExtractedCodes,
  toControllerUnits,
  toDisplayUnits,
  displayVoucherFields,
  durationToMinutes,
  splitDurationMinutes,
  formatDurationUnits,
  VERIFIED_VOUCHER_FIELDS,
  validateGenerationPayload,
  validateTrafficLimitGb,
  gbToOmadaTrafficLimit,
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

describe("display units in the creation form", () => {
  it("shows Kbps/MB values as Mbps/GB without changing their meaning", () => {
    const controller = {
      trafficLimit: 2048,
      rateLimit: { mode: 0, customRateLimit: { downLimit: 5120, upLimit: 512 } },
    };
    const shown = toDisplayUnits(controller as never) as Record<string, never>;
    expect(shown["trafficLimit"]).toBe(2);
    expect((shown["rateLimit"] as never as Record<string, Record<string, number>>)["customRateLimit"]).toEqual({
      downLimit: 5,
      upLimit: 0.5,
    });
    expect(toControllerUnits(shown as never)).toEqual(controller);
  });

  it("labels the limit fields in Mbps and GB and scales their allowed range", () => {
    const fields = displayVoucherFields(VERIFIED_VOUCHER_FIELDS);
    const traffic = fields.find((f) => f.name === "trafficLimit");
    expect(traffic?.unitSuffix).toBe("GB");
    expect(traffic?.description).toMatch(/GB/);
    const rate = fields.find((f) => f.name === "rateLimit");
    const down = rate?.fields?.find((f) => f.name === "customRateLimit")?.fields?.find((f) => f.name === "downLimit");
    expect(down?.unitSuffix).toBe("Mbps");
  });
});

describe("traffic limit in GB", () => {
  it("converts GB to the exact integer MB Omada expects", () => {
    expect(gbToOmadaTrafficLimit(1)).toBe(1024);
    expect(gbToOmadaTrafficLimit(2)).toBe(2048);
    expect(gbToOmadaTrafficLimit(5)).toBe(5120);
    expect(gbToOmadaTrafficLimit(10)).toBe(10240);
    expect(gbToOmadaTrafficLimit(0)).toBe(0);
  });

  it("round-trips an existing saved calibration without multiplying twice", () => {
    const saved = { trafficLimitEnable: true, trafficLimit: 5120 };
    const shown = toDisplayUnits(saved as never);
    expect(shown["trafficLimit"]).toBe(5);
    expect(toControllerUnits(shown)).toEqual(saved);
    // Converting an already-converted payload again must not change it further.
    expect(toControllerUnits(toDisplayUnits(toControllerUnits(shown)))).toEqual(saved);
  });

  it("keeps the data cap off when it is disabled", () => {
    const payload = toControllerUnits({ trafficLimitEnable: false } as never);
    expect(payload["trafficLimit"]).toBeUndefined();
    expect(validateGenerationPayload({ ...defaultGenerationValues(), name: "Test", ...payload })).toEqual([]);
  });

  it("rejects a GB value that is not a whole number of MB", () => {
    expect(validateTrafficLimitGb(1)).toBeNull();
    expect(validateTrafficLimitGb(0.5)).toBeNull();
    expect(validateTrafficLimitGb(1 / 1024)).toBeNull();
    expect(validateTrafficLimitGb(1.00001)).toBeTruthy();
    expect(validateTrafficLimitGb(-1)).toBeTruthy();
    expect(validateTrafficLimitGb("abc")).toBeTruthy();
  });

  it("sends a valid converted payload for a 5 GB product", () => {
    const payload = {
      ...defaultGenerationValues(),
      name: "Test",
      ...toControllerUnits({ trafficLimitEnable: true, trafficLimit: 5 } as never),
    };
    expect(payload["trafficLimit"]).toBe(5120);
    expect(validateGenerationPayload(payload)).toEqual([]);
  });
});

describe("duration units", () => {
  it("converts the admin's unit into the controller's minutes", () => {
    expect(durationToMinutes(30, "minutes")).toBe(30);
    expect(durationToMinutes(12, "hours")).toBe(720);
    expect(durationToMinutes(3, "days")).toBe(4320);
  });

  it("shows a saved calibration in its natural unit without changing meaning", () => {
    expect(splitDurationMinutes(4320)).toEqual({ value: 3, unit: "days" });
    expect(splitDurationMinutes(720)).toEqual({ value: 12, unit: "hours" });
    expect(splitDurationMinutes(90)).toEqual({ value: 90, unit: "minutes" });
    expect(durationToMinutes(splitDurationMinutes(480).value, splitDurationMinutes(480).unit)).toBe(480);
  });

  it("formats a human-readable duration for review", () => {
    expect(formatDurationUnits(720)).toBe("12 Hours");
    expect(formatDurationUnits(1440)).toBe("1 Day");
  });

  it("stays valid against the verified controller rules after conversion", () => {
    const payload = { ...defaultGenerationValues(), name: "Test", duration: durationToMinutes(3, "days") };
    expect(validateGenerationPayload(payload)).toEqual([]);
  });
});
