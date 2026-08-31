import { describe, expect, it } from "vitest";
import { buildRadioPatchBody } from "../omada-devices.server";
import { describeDeviceStatus } from "../omada-devices";

describe("AP radio patch body", () => {
  it("maps bands to the controller's own field names", () => {
    const body = buildRadioPatchBody([{ band: "5g", channel: "4", freq: 5240 }]);
    expect(Object.keys(body)).toEqual(["radioSetting5g"]);
    expect(body["radioSetting5g"]).toMatchObject({ radioEnable: true, channel: "4", freq: 5240 });
  });

  it("sends nothing but the off switch when a radio is disabled", () => {
    const body = buildRadioPatchBody([{ band: "2g", radioEnable: false, channel: "6" }]);
    expect(body["radioSetting2g"]).toEqual({ radioEnable: false });
  });

  it("only sends a custom dBm value when the custom power level is chosen", () => {
    const auto = buildRadioPatchBody([{ band: "2g", txPowerLevel: 4, txPower: 20 }]) as any;
    expect(auto.radioSetting2g.txPower).toBeUndefined();
    const custom = buildRadioPatchBody([{ band: "2g", txPowerLevel: 3, txPower: 20 }]) as any;
    expect(custom.radioSetting2g.txPower).toBe(20);
  });

  it("ignores unknown bands rather than guessing a field", () => {
    expect(buildRadioPatchBody([{ band: "7g" as never }])).toEqual({});
  });
});

describe("pending-adoption detection used by the device drawer", () => {
  it("treats the controller's pending codes as pending", () => {
    expect(describeDeviceStatus(2, 20).health).toBe("pending");
    expect(describeDeviceStatus(1, 14).health).toBe("online");
  });
});
