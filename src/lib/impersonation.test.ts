import { describe, expect, it } from "vitest";
import {
  canOperate,
  filterOperatorAudit,
  isImpersonatable,
  type OperatorAuditRow,
} from "@/lib/impersonation";

const row = (over: Partial<OperatorAuditRow>): OperatorAuditRow => ({
  id: "1",
  created_at: "2026-01-01T00:00:00Z",
  action: "Admin Action — Acting as Customer: Voucher purchase",
  target: "Maria Cruz (customer)",
  actorName: "Shop Admin",
  ecosystemId: "eco-1",
  operatorId: "op-1",
  operatorRole: "admin",
  targetId: "t-1",
  targetRole: "customer",
  reason: "Helping with a purchase",
  entity: "voucher_sale",
  details: {},
  ...over,
});

describe("act-as scope", () => {
  it("only admins and super admins may enter accounts", () => {
    expect(canOperate("admin")).toBe(true);
    expect(canOperate("super_admin")).toBe(true);
    expect(canOperate("reseller")).toBe(false);
    expect(canOperate("subreseller")).toBe(false);
    expect(canOperate("customer")).toBe(false);
  });

  it("never offers an admin or super admin as a target", () => {
    expect(isImpersonatable("customer")).toBe(true);
    expect(isImpersonatable("reseller")).toBe(true);
    expect(isImpersonatable("subreseller")).toBe(true);
    expect(isImpersonatable("admin")).toBe(false);
    expect(isImpersonatable("super_admin")).toBe(false);
  });
});

describe("operator audit filters", () => {
  const rows = [
    row({}),
    row({ id: "2", targetRole: "reseller", target: "Ben Reseller (reseller)", operatorId: "op-2" }),
  ];

  it("filters by target role", () => {
    expect(filterOperatorAudit(rows, { targetRole: "reseller" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterOperatorAudit(rows, { targetRole: "all" })).toHaveLength(2);
  });

  it("filters by operator", () => {
    expect(filterOperatorAudit(rows, { operatorId: "op-1" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("searches action, target and reason", () => {
    expect(filterOperatorAudit(rows, { query: "maria" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterOperatorAudit(rows, { query: "helping" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterOperatorAudit(rows, { query: "nothing here" })).toHaveLength(0);
  });
});
