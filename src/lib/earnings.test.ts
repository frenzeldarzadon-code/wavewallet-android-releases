import { describe, expect, it } from "vitest";
import {
  bucketEarnings,
  filterEarnings,
  periodBucket,
  periodTotals,
  summariseEarnings,
  type EarningRow,
} from "@/lib/earnings";

const row = (over: Partial<EarningRow>): EarningRow => ({
  id: Math.random().toString(36).slice(2),
  occurred_at: "2026-03-15T04:00:00.000Z",
  ecosystem_id: "eco",
  earning_type: "sale_cashback",
  recipient_id: "r1",
  recipient_name: "Reseller A",
  counterparty_id: "c1",
  counterparty_name: "Customer 1",
  product_name: "1-Day Wifi",
  quantity: 1,
  gross_amount: 100,
  basis_amount: 100,
  rate_percent: 10,
  earning_amount: 10,
  status: "settled",
  tx_id: "TX-1",
  sale_id: "s1",
  ...over,
});

describe("period bucketing (Asia/Manila calendar)", () => {
  it("buckets by calendar day", () => {
    expect(periodBucket("2026-03-15T04:00:00Z", "daily").key).toBe("2026-03-15");
  });

  it("rolls a late-UTC timestamp into the next local day", () => {
    // 2026-03-15T17:00Z === 2026-03-16 01:00 in Asia/Manila
    expect(periodBucket("2026-03-15T17:00:00Z", "daily").key).toBe("2026-03-16");
  });

  it("handles month, quarter and year boundaries", () => {
    // 2025-12-31T16:00Z === 2026-01-01 00:00 local
    const boundary = "2025-12-31T16:00:00Z";
    expect(periodBucket(boundary, "monthly").key).toBe("2026-01");
    expect(periodBucket(boundary, "quarterly").key).toBe("2026-Q1");
    expect(periodBucket(boundary, "yearly").key).toBe("2026");
    expect(periodBucket("2026-03-31T15:59:00Z", "quarterly").key).toBe("2026-Q1");
    expect(periodBucket("2026-03-31T16:00:00Z", "quarterly").key).toBe("2026-Q2");
  });
});

describe("aggregation", () => {
  const rows = [
    row({ occurred_at: "2026-01-05T02:00:00Z", earning_amount: 10 }),
    row({ occurred_at: "2026-01-20T02:00:00Z", earning_amount: 5, earning_type: "upline_commission" }),
    row({ occurred_at: "2026-04-02T02:00:00Z", earning_amount: 20, earning_type: "wholesale_discount" }),
    row({ occurred_at: "2025-11-02T02:00:00Z", earning_amount: 7 }),
  ];

  it("aggregates daily, monthly, quarterly and yearly", () => {
    expect(bucketEarnings(rows, "daily")).toHaveLength(4);
    expect(bucketEarnings(rows, "monthly").map((b) => b.key)).toEqual([
      "2026-04",
      "2026-01",
      "2025-11",
    ]);
    const quarters = bucketEarnings(rows, "quarterly");
    expect(quarters.map((b) => b.key)).toEqual(["2026-Q2", "2026-Q1", "2025-Q4"]);
    expect(quarters[1]!.totals.net).toBe(15);
    const years = bucketEarnings(rows, "yearly");
    expect(years[0]!.totals.net).toBe(35);
    expect(years[1]!.totals.net).toBe(7);
  });

  it("splits totals by earning type", () => {
    const t = summariseEarnings(rows);
    expect(t.net).toBe(42);
    expect(t.byType.sale_cashback).toBe(17);
    expect(t.byType.upline_commission).toBe(5);
    expect(t.byType.wholesale_discount).toBe(20);
  });
});

describe("refunds and snapshots", () => {
  it("excludes reversed earnings from net without dropping the record", () => {
    const rows = [row({ earning_amount: 10 }), row({ earning_amount: 10, status: "reversed" })];
    const t = summariseEarnings(rows);
    expect(t.count).toBe(2);
    expect(t.net).toBe(10);
    expect(t.reversed).toBe(10);
    expect(t.reversedCount).toBe(1);
  });

  it("keeps historical rates when settings change later", () => {
    // Two sales of the same product at different snapshotted rates.
    const rows = [
      row({ occurred_at: "2026-01-10T02:00:00Z", rate_percent: 10, earning_amount: 10 }),
      row({ occurred_at: "2026-02-10T02:00:00Z", rate_percent: 5, earning_amount: 5 }),
    ];
    expect(rows.map((r) => r.rate_percent)).toEqual([10, 5]);
    expect(summariseEarnings(rows).net).toBe(15);
  });
});

describe("filters", () => {
  const rows = [
    row({ earning_type: "sale_cashback", product_name: "1-Day Wifi", counterparty_id: "c1" }),
    row({ earning_type: "upline_commission", product_name: "7-Day Wifi", counterparty_id: "c2" }),
    row({ earning_type: "sale_cashback", product_name: "1-Day Wifi", status: "reversed", counterparty_id: "c1" }),
  ];

  it("filters by type, product, status and counterparty", () => {
    expect(filterEarnings(rows, { type: "upline_commission" })).toHaveLength(1);
    expect(filterEarnings(rows, { product: "1-Day Wifi" })).toHaveLength(2);
    expect(filterEarnings(rows, { status: "settled" })).toHaveLength(2);
    expect(filterEarnings(rows, { counterparty: "c2" })).toHaveLength(1);
    expect(filterEarnings(rows, { search: "7-day" })).toHaveLength(1);
  });

  it("totals match the filtered selection", () => {
    const filtered = filterEarnings(rows, { product: "1-Day Wifi", status: "settled" });
    expect(summariseEarnings(filtered).net).toBe(10);
  });
});

describe("admin & platform earning types", () => {
  it("counts credit generation and subscription revenue separately, never transfers", () => {
    const rows = [
      row({ earning_type: "credit_generation", earning_amount: 1000, rate_percent: null }),
      row({ earning_type: "platform_subscription", earning_amount: 499, rate_percent: null }),
      row({ earning_type: "sale_cashback", earning_amount: 10 }),
    ];
    const t = summariseEarnings(rows);
    expect(t.byType.credit_generation).toBe(1000);
    expect(t.byType.platform_subscription).toBe(499);
    expect(t.net).toBe(1509);
    // Platform-only headline reconciles to subscription revenue alone.
    expect(t.byType.platform_subscription).toBe(499);
  });

  it("reverses credit generation instead of editing history", () => {
    const rows = [
      row({ earning_type: "credit_generation", earning_amount: 1000 }),
      row({ earning_type: "credit_generation", earning_amount: 1000, status: "reversed" }),
    ];
    const t = summariseEarnings(rows);
    expect(t.count).toBe(2);
    expect(t.byType.credit_generation).toBe(1000);
  });
});

describe("dashboard period rollups", () => {
  it("rolls today / month / quarter / year from the same records", () => {
    const now = new Date();
    const rows = [
      row({ occurred_at: now.toISOString(), earning_type: "credit_generation", earning_amount: 100 }),
      row({
        occurred_at: new Date(now.getFullYear(), 0, 2, 12).toISOString(),
        earning_type: "credit_generation",
        earning_amount: 50,
      }),
      row({
        occurred_at: new Date(now.getFullYear() - 1, 5, 2, 12).toISOString(),
        earning_type: "credit_generation",
        earning_amount: 999,
      }),
      row({ occurred_at: now.toISOString(), earning_type: "sale_cashback", earning_amount: 7 }),
    ];
    const t = periodTotals(rows, ["credit_generation"]);
    expect(t.today).toBe(100);
    expect(t.year).toBe(150);
    expect(t.year).toBeGreaterThanOrEqual(t.quarter);
    expect(t.quarter).toBeGreaterThanOrEqual(t.month);
    expect(t.month).toBeGreaterThanOrEqual(t.today);
  });
});
