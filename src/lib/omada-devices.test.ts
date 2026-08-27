import { describe, expect, it } from "vitest";
import {
  antennaTypeLabel,
  describeDeviceStatus,
  normaliseMac,
  uplinkLabel,
} from "./omada-devices";

describe("controller status mapping", () => {
  it("reads the live Sagada Wave states", () => {
    // Values observed on Controller 6.2.14.11 for this site.
    expect(describeDeviceStatus(1, 14)).toEqual({ label: "Connected", health: "online" });
    expect(describeDeviceStatus(1, 15)).toEqual({
      label: "Connected (wireless)",
      health: "online",
    });
    expect(describeDeviceStatus(0, 0)).toEqual({ label: "Disconnected", health: "offline" });
  });

  it("keeps problem states distinct from healthy ones", () => {
    expect(describeDeviceStatus(3, 30).health).toBe("warning");
    expect(describeDeviceStatus(2, 22).health).toBe("pending");
    expect(describeDeviceStatus(null, 13).label).toBe("Rebooting");
  });

  it("never pretends an unrecognised code is healthy", () => {
    expect(describeDeviceStatus(99, 998)).toEqual({
      label: "Unknown reported state (998)",
      health: "unknown",
    });
    expect(describeDeviceStatus(null, null).health).toBe("unknown");
  });

  it("falls back to the coarse status when the detail code is unknown", () => {
    expect(describeDeviceStatus(1, 997)).toEqual({ label: "Connected", health: "online" });
  });
});

describe("antenna wording", () => {
  it("shows Antenna to operators while keeping the real device type", () => {
    expect(antennaTypeLabel("ap")).toBe("Antenna (access point)");
    expect(antennaTypeLabel("gateway")).toBe("Router / gateway");
    expect(antennaTypeLabel("switch")).toBe("Switch");
  });
});

describe("device address matching", () => {
  it("compares addresses in one shape", () => {
    expect(normaliseMac("e0:d3:62:2d:aa:a9")).toBe("E0-D3-62-2D-AA-A9");
    expect(normaliseMac(" 58-04-4f-77-80-ea ")).toBe("58-04-4F-77-80-EA");
  });
});
