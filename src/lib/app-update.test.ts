import { describe, expect, it } from "vitest";
import {
  beginCriticalOperation,
  evaluateUpdate,
  isCriticalOperationActive,
} from "@/lib/app-update";
import type { UpdateManifest } from "@/lib/update-manifest";

const manifest = (patch: Partial<UpdateManifest> = {}): UpdateManifest => ({
  web: { version: "1.1.0", buildId: "build-2" },
  android: {
    versionCode: 2,
    versionName: "1.1.0",
    minVersionCode: 2,
    updateUrl: "https://wallet.sagadawave.com/download",
  },
  notes: "notes",
  checkedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("evaluateUpdate — web", () => {
  it("reports up to date when the build id matches", () => {
    const s = evaluateUpdate({ buildId: "build-2", version: "1.1.0", native: null }, manifest());
    expect(s.webUpdateAvailable).toBe(false);
    expect(s.offline).toBe(false);
  });

  it("detects a newer web build", () => {
    const s = evaluateUpdate({ buildId: "build-1", version: "1.0.0", native: null }, manifest());
    expect(s.webUpdateAvailable).toBe(true);
    expect(s.latestWebVersion).toBe("1.1.0");
  });

  it("never prompts from a dev build", () => {
    expect(
      evaluateUpdate({ buildId: "dev", version: "1.1.0", native: null }, manifest())
        .webUpdateAvailable,
    ).toBe(false);
  });

  it("fails safely with no manifest and suggests nothing", () => {
    const s = evaluateUpdate({ buildId: "build-1", version: "1.0.0", native: null }, null);
    expect(s.offline).toBe(true);
    expect(s.webUpdateAvailable).toBe(false);
    expect(s.androidUpdateAvailable).toBe(false);
  });
});

describe("evaluateUpdate — Android shell", () => {
  const native = { versionCode: 1, versionName: "1.0.0" };

  it("ignores Android entirely in a plain browser", () => {
    const s = evaluateUpdate({ buildId: "build-2", version: "1.1.0", native: null }, manifest());
    expect(s.androidUpdateAvailable).toBe(false);
    expect(s.androidUpdateRequired).toBe(false);
  });

  it("detects an outdated installed APK", () => {
    const s = evaluateUpdate({ buildId: "build-2", version: "1.1.0", native }, manifest());
    expect(s.androidUpdateAvailable).toBe(true);
    expect(s.androidUpdateRequired).toBe(true);
    expect(s.androidUpdateUrl).toBe("https://wallet.sagadawave.com/download");
  });

  it("is satisfied once the newest APK is installed", () => {
    const s = evaluateUpdate(
      { buildId: "build-2", version: "1.1.0", native: { versionCode: 2, versionName: "1.1.0" } },
      manifest(),
    );
    expect(s.androidUpdateAvailable).toBe(false);
    expect(s.androidUpdateRequired).toBe(false);
  });

  it("recommends without requiring when above the minimum", () => {
    const s = evaluateUpdate(
      { buildId: "build-2", version: "1.1.0", native: { versionCode: 2, versionName: "1.1.0" } },
      manifest({
        android: {
          versionCode: 3,
          versionName: "1.2.0",
          minVersionCode: 2,
          updateUrl: "https://wallet.sagadawave.com/download",
        },
      }),
    );
    expect(s.androidUpdateAvailable).toBe(true);
    expect(s.androidUpdateRequired).toBe(false);
  });
});

describe("critical operation guard", () => {
  it("blocks background checks while money is moving, and releases once", () => {
    expect(isCriticalOperationActive()).toBe(false);
    const end = beginCriticalOperation();
    expect(isCriticalOperationActive()).toBe(true);
    end();
    end();
    expect(isCriticalOperationActive()).toBe(false);
  });
});
