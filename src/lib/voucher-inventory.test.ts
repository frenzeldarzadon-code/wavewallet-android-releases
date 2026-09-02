import { describe, expect, it } from "vitest";
import {
  batchDeleteBlockReason,
  canDeleteCode,
  canDeleteUnusedCodes,
  isBatchDeletable,
  type VoucherBatch,
} from "@/lib/voucher-inventory";

const batch = (over: Partial<VoucherBatch> = {}): VoucherBatch => ({
  batch_id: "b1",
  product_id: "p1",
  product_name: "PHP10 voucher",
  actor_name: "Admin",
  source: "paste",
  created_at: "2026-08-12T10:00:00Z",
  total_codes: 10,
  unused_count: 10,
  sold_count: 0,
  deletable: true,
  ...over,
});

describe("individual voucher code deletion", () => {
  it("allows deleting an unused, unassigned code", () => {
    expect(canDeleteCode({ status: "unused", sold_to: null, sale_id: null })).toBe(true);
  });

  it("blocks deleting a sold code", () => {
    expect(canDeleteCode({ status: "sold", sold_to: "u1", sale_id: "s1" })).toBe(false);
  });

  it("blocks a code that is still marked unused but assigned to a buyer", () => {
    expect(canDeleteCode({ status: "unused", sold_to: "u1", sale_id: null })).toBe(false);
  });

  it("blocks a code referenced by a sale", () => {
    expect(canDeleteCode({ status: "unused", sold_to: null, sale_id: "s1" })).toBe(false);
  });
});

describe("whole-batch deletion", () => {
  it("allows deleting a fully unused batch", () => {
    expect(batchDeleteBlockReason(batch())).toBeNull();
    expect(isBatchDeletable(batch())).toBe(true);
  });

  it("blocks a mixed batch and explains why", () => {
    const reason = batchDeleteBlockReason(batch({ unused_count: 7, sold_count: 3 }));
    expect(reason).toContain("3 of 10");
    expect(reason).toContain("individually");
  });

  it("blocks an empty batch", () => {
    expect(batchDeleteBlockReason(batch({ total_codes: 0, unused_count: 0 }))).toContain(
      "no codes left",
    );
  });
});

describe("delete-unused-only cleanup for mixed batches", () => {
  it("is unavailable for a fully unused batch (whole-batch delete covers it)", () => {
    expect(canDeleteUnusedCodes(batch())).toBe(false);
  });

  it("is available when at least one code is used and at least one is unused", () => {
    expect(canDeleteUnusedCodes(batch({ unused_count: 7, sold_count: 3 }))).toBe(true);
  });

  it("is unavailable when every code is used (nothing unused to clean)", () => {
    expect(canDeleteUnusedCodes(batch({ unused_count: 0, sold_count: 10 }))).toBe(false);
  });

  it("never replaces whole-batch deletion eligibility rules", () => {
    // A mixed batch still cannot be deleted whole — cleanup is unused-only.
    const mixed = batch({ unused_count: 7, sold_count: 3 });
    expect(isBatchDeletable(mixed)).toBe(false);
    expect(canDeleteUnusedCodes(mixed)).toBe(true);
  });
});
