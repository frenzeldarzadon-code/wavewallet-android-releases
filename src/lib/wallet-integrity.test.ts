import { describe, expect, it } from "vitest";
import {
  integrityHeadline,
  isUnexplained,
  summarizeWalletIntegrity,
  unexplainedTotals,
  type WalletIntegrityRow,
} from "./wallet-integrity";

const row = (over: Partial<WalletIntegrityRow> = {}): WalletIntegrityRow => ({
  kind: "credits",
  account_id: "a1",
  user_id: "u1",
  ecosystem_id: "e1",
  member_name: "Member",
  balance: 100,
  ledger_sum: 100,
  difference: 0,
  oldest_entry: "2026-01-01T00:00:00Z",
  purge_explained: false,
  ...over,
});

describe("wallet integrity", () => {
  it("treats a matching wallet as healthy", () => {
    const s = summarizeWalletIntegrity([row()]);
    expect(s.ok).toBe(true);
    expect(s.unexplained).toHaveLength(0);
    expect(s.explained).toHaveLength(0);
  });

  it("flags a difference the retention purge cannot explain", () => {
    const bad = row({ balance: 130, ledger_sum: 100, difference: 30, purge_explained: false });
    expect(isUnexplained(bad)).toBe(true);
    const s = summarizeWalletIntegrity([bad]);
    expect(s.ok).toBe(false);
    expect(s.unexplained).toHaveLength(1);
  });

  it("does not flag a difference created by the 12-month history cleanup", () => {
    // The purge deletes old ledger rows and deliberately preserves balances,
    // so this divergence is expected rather than corruption.
    const purged = row({ balance: 720, ledger_sum: 690, difference: 30, purge_explained: true });
    expect(isUnexplained(purged)).toBe(false);
    const s = summarizeWalletIntegrity([purged]);
    expect(s.ok).toBe(true);
    expect(s.explained).toHaveLength(1);
    expect(s.unexplained).toHaveLength(0);
  });

  it("counts every checked wallet, including healthy ones", () => {
    const s = summarizeWalletIntegrity([
      row(),
      row({ account_id: "a2", difference: 5, balance: 105, ledger_sum: 100 }),
    ]);
    expect(s.checked).toBe(2);
    expect(s.unexplained).toHaveLength(1);
  });

  it("separates credit and points shortfalls, keeping the sign", () => {
    const totals = unexplainedTotals([
      row({ difference: 30 }),
      row({ account_id: "a2", kind: "points", difference: -12 }),
      row({ account_id: "a3", difference: 999, purge_explained: true }),
    ]);
    expect(totals).toEqual({ credits: 30, points: -12 });
  });

  it("summarises a clean platform in plain language", () => {
    expect(integrityHeadline(summarizeWalletIntegrity([row()]))).toBe(
      "All wallets reconcile with their transaction history.",
    );
  });

  it("mentions purged history when that is the only difference", () => {
    const s = summarizeWalletIntegrity([row({ difference: 30, purge_explained: true })]);
    expect(integrityHeadline(s)).toContain("old history was cleaned up");
  });

  it("pluralises the problem headline correctly", () => {
    const one = summarizeWalletIntegrity([row({ difference: 1 })]);
    expect(integrityHeadline(one)).toBe("1 wallet does not match their transaction history.");
    const two = summarizeWalletIntegrity([row({ difference: 1 }), row({ account_id: "a2", difference: 2 })]);
    expect(integrityHeadline(two)).toContain("2 wallets");
  });
});
