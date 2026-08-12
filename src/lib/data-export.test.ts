import { describe, expect, it } from "vitest";
import {
  EXPORT_DATASETS,
  PLATFORM_SCOPE,
  buildManifest,
  datasetColumnsAreSafe,
  datasetGroups,
  exportFileName,
  fileStamp,
  slugifyScope,
} from "./data-export";

const at = new Date("2026-08-12T20:18:45.000Z");

describe("export dataset safety", () => {
  it("never declares a credential-bearing column", () => {
    for (const d of EXPORT_DATASETS) {
      expect(datasetColumnsAreSafe(d), `${d.id} declares a restricted column`).toBe(true);
    }
  });

  it("never uses a wildcard column selection", () => {
    for (const d of EXPORT_DATASETS) {
      expect(d.columns.length).toBeGreaterThan(0);
      expect(d.columns).not.toContain("*");
    }
  });

  it("excludes ecosystem signup tokens", () => {
    const eco = EXPORT_DATASETS.find((d) => d.id === "ecosystems")!;
    expect(eco.columns).not.toContain("signup_token");
  });

  it("excludes subscription payment proof paths", () => {
    const subs = EXPORT_DATASETS.find((d) => d.id === "subscription_requests")!;
    expect(subs.columns).not.toContain("proof_path");
  });

  it("rejects a dataset that smuggles in a secret column", () => {
    const bad = { ...EXPORT_DATASETS[0]!, columns: ["id", "encrypted_password"] };
    expect(datasetColumnsAreSafe(bad)).toBe(false);
  });

  it("has unique dataset ids", () => {
    const ids = EXPORT_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the operational record categories", () => {
    const ids = EXPORT_DATASETS.map((d) => d.id);
    for (const required of [
      "voucher_codes",
      "voucher_imports",
      "credit_ledger",
      "points_ledger",
      "voucher_sales",
      "sale_commissions",
      "profiles",
    ]) {
      expect(ids).toContain(required);
    }
  });
});

describe("tenant scoping", () => {
  it("gives every ecosystem-owned dataset a scoping column", () => {
    for (const d of EXPORT_DATASETS) {
      if (d.id === "user_roles") continue;
      expect(d.ecosystemColumn, `${d.id} has no scope column`).toBeTruthy();
    }
  });

  it("scopes the ecosystems table by its own id", () => {
    expect(EXPORT_DATASETS.find((d) => d.id === "ecosystems")!.ecosystemColumn).toBe("id");
  });
});

describe("file labelling", () => {
  it("stamps date and time in UTC", () => {
    expect(fileStamp(at)).toBe("2026-08-12_2018Z");
  });

  it("names files with dataset, scope and timestamp", () => {
    expect(
      exportFileName("credit_ledger", { ecosystemId: "e1", ecosystemLabel: "Sagada Wave" }, at),
    ).toBe("wavewallet_credit-ledger_sagada-wave_2026-08-12_2018Z.csv");
  });

  it("labels a platform-wide export distinctly", () => {
    expect(exportFileName("credit_ledger", PLATFORM_SCOPE, at)).toContain("all-ecosystems");
  });

  it("slugifies awkward shop names", () => {
    expect(slugifyScope("Ana's  Wi-Fi / Shop!")).toBe("ana-s-wi-fi-shop");
  });
});

describe("manifest", () => {
  it("records scope, actor, time and row counts", () => {
    const text = buildManifest({
      results: [
        { datasetId: "credit_ledger", label: "Credit ledger", rowCount: 12, fileName: "a.csv" },
        { datasetId: "points_ledger", label: "Points ledger", rowCount: 3, fileName: "b.csv" },
      ],
      scope: { ecosystemId: "e1", ecosystemLabel: "Sagada Wave" },
      actorName: "Platform Owner",
      at,
    });
    expect(text).toContain("2026-08-12T20:18:45.000Z");
    expect(text).toContain("Sagada Wave");
    expect(text).toContain("Platform Owner");
    expect(text).toContain("Total rows: 15");
    expect(text).toContain("no production data was altered");
  });

  it("marks a platform-wide export as covering all ecosystems", () => {
    const text = buildManifest({ results: [], scope: PLATFORM_SCOPE, actorName: "Owner", at });
    expect(text).toContain("Entire platform");
  });
});

describe("grouping", () => {
  it("keeps every dataset in exactly one group", () => {
    const total = datasetGroups().reduce((s, g) => s + g.datasets.length, 0);
    expect(total).toBe(EXPORT_DATASETS.length);
  });
});
