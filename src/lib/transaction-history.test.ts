import { describe, expect, it } from "vitest";
import {
  buildTransactionFeed,
  canReverse,
  filterFeed,
  transferState,
  type TxRow,
  type VoucherSaleRow,
} from "@/lib/transaction-history";
import type { CreditEntry } from "@/lib/wallet";
import type { ReversalRecord } from "@/lib/transfer-reversal";

const entry = (over: Partial<CreditEntry>): CreditEntry => ({
  id: "e1",
  direction: "debit",
  amount: 1000,
  balance_after: 4000,
  reason: "Credit transfer sent",
  reference: null,
  tx_id: "TX-1",
  created_at: "2026-08-10T10:00:00Z",
  user_id: "sender",
  entry_kind: "transfer",
  sale_id: null,
  ...over,
});

const reversal = (over: Partial<ReversalRecord>): ReversalRecord => ({
  id: "r1",
  original_tx_id: "TX-1",
  reversal_tx_id: "TX-R1",
  sender_id: "sender",
  recipient_id: "recipient",
  original_amount: 1000,
  reversed_amount: 1000,
  kind: "full",
  reason: "Wrong recipient",
  note: null,
  actor_name: "Admin",
  created_at: "2026-08-11T10:00:00Z",
  ...over,
});

const sale: VoucherSaleRow = {
  id: "s1",
  created_at: "2026-08-09T10:00:00Z",
  buyer_id: "buyer",
  reseller_id: "seller",
  product_name: "1 Day Unli",
  quantity: 2,
  sale_price: 100,
  discount_percent: 10,
  payment_method: "credits",
  tx_id: "TX-S1",
  points_spent: 0,
  points_earned: 5,
  refunded_at: null,
};

describe("transferState", () => {
  it("marks an untouched transfer fully reversible", () => {
    const s = transferState(entry({}), new Map());
    expect(s.status).toBe("reversible");
    expect(s.remaining).toBe(1000);
    expect(s.reversedAmount).toBe(0);
  });

  it("marks a fully reversed transfer as reversed with nothing remaining", () => {
    const s = transferState(entry({}), new Map([["TX-1", [reversal({})]]]));
    expect(s.status).toBe("reversed");
    expect(s.remaining).toBe(0);
  });

  it("reports the remaining amount on a partial reversal", () => {
    const s = transferState(
      entry({}),
      new Map([["TX-1", [reversal({ kind: "partial", reversed_amount: 400 })]]]),
    );
    expect(s.status).toBe("partially_reversed");
    expect(s.remaining).toBe(600);
  });

  it("accumulates several partial reversals and closes the transfer at the total", () => {
    const s = transferState(
      entry({}),
      new Map([
        [
          "TX-1",
          [
            reversal({ id: "r1", kind: "partial", reversed_amount: 400 }),
            reversal({ id: "r2", kind: "partial", reversed_amount: 250 }),
          ],
        ],
      ]),
    );
    expect(s.reversedAmount).toBe(650);
    expect(s.remaining).toBe(350);
    expect(s.status).toBe("partially_reversed");

    const done = transferState(
      entry({}),
      new Map([
        [
          "TX-1",
          [
            reversal({ id: "r1", kind: "partial", reversed_amount: 400 }),
            reversal({ id: "r2", kind: "full", reversed_amount: 600 }),
          ],
        ],
      ]),
    );
    expect(done.status).toBe("reversed");
    expect(done.remaining).toBe(0);
  });
});

describe("buildTransactionFeed", () => {
  const feed = buildTransactionFeed({
    ledger: [
      entry({}),
      entry({ id: "e2", reason: "Credit transfer received", direction: "credit", user_id: "recipient" }),
      entry({
        id: "e3",
        reason: "Voucher purchase",
        entry_kind: "purchase",
        sale_id: "s1",
        created_at: "2026-08-09T10:00:00Z",
      }),
      entry({
        id: "e4",
        reason: "Sale cashback",
        entry_kind: "sale_commission",
        direction: "credit",
        created_at: "2026-08-08T10:00:00Z",
      }),
      entry({
        id: "e5",
        reason: "Admin credit adjustment",
        entry_kind: "general",
        tx_id: "TX-A",
        created_at: "2026-08-07T10:00:00Z",
      }),
    ],
    sales: [sale],
    reversals: [reversal({})],
  });

  it("includes ledger, sale and reversal rows in one chronological feed", () => {
    expect(feed).toHaveLength(7);
    const dates = feed.map((r) => r.createdAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
    expect(feed.filter((r) => r.kind === "reversal")).toHaveLength(1);
    expect(feed.filter((r) => r.kind === "purchase")).toHaveLength(2);
    expect(feed.filter((r) => r.kind === "earning")).toHaveLength(1);
    expect(feed.filter((r) => r.kind === "adjustment")).toHaveLength(1);
  });

  it("never offers Reverse on received legs, purchases, earnings or reversed transfers", () => {
    for (const row of feed) expect(canReverse(row)).toBe(false);
  });

  it("offers Reverse on an unreversed outgoing transfer only", () => {
    const rows = buildTransactionFeed({ ledger: [entry({})], sales: [], reversals: [] });
    expect(canReverse(rows[0]!)).toBe(true);
    expect(rows[0]!.transfer?.remaining).toBe(1000);
  });

  it("offers Reverse on the production credit-load wording written by transfer_credits", () => {
    const rows = buildTransactionFeed({
      ledger: [
        entry({ id: "p1", reason: "Credit load to customer", entry_kind: "general" }),
        entry({
          id: "p2",
          reason: "Credit load from reseller",
          direction: "credit",
          entry_kind: "general",
          tx_id: "TX-1-R",
          user_id: "recipient",
        }),
      ],
      sales: [],
      reversals: [],
    });
    const out = rows.find((r) => r.entry?.id === "p1")!;
    const incoming = rows.find((r) => r.entry?.id === "p2")!;
    expect(out.kind).toBe("transfer");
    expect(canReverse(out)).toBe(true);
    expect(incoming.kind).toBe("transfer");
    expect(canReverse(incoming)).toBe(false);
  });

  it("recognises a transfer from its paired receive leg even with unknown wording", () => {
    const rows = buildTransactionFeed({
      ledger: [
        entry({ id: "u1", reason: "Float release", entry_kind: "general" }),
        entry({
          id: "u2",
          reason: "Float received",
          direction: "credit",
          tx_id: "TX-1-R",
          user_id: "recipient",
        }),
      ],
      sales: [],
      reversals: [],
    });
    expect(canReverse(rows.find((r) => r.entry?.id === "u1")!)).toBe(true);
  });

  it("never offers Reverse on adjustments or reversal entries", () => {
    const rows = buildTransactionFeed({
      ledger: [
        entry({ id: "a1", reason: "Admin credit adjustment", tx_id: "TX-A" }),
        entry({
          id: "a2",
          reason: "Credit transfer reversed — Wrong recipient",
          entry_kind: "transfer_reversal",
          tx_id: "TX-R9",
        }),
      ],
      sales: [],
      reversals: [],
    });
    expect(rows.map((r) => r.kind)).toEqual(["adjustment", "reversal"]);
    for (const r of rows) expect(canReverse(r)).toBe(false);
  });

  it("keeps offering Reverse for the remainder of a partial reversal", () => {
    const rows = buildTransactionFeed({
      ledger: [entry({})],
      sales: [],
      reversals: [reversal({ kind: "partial", reversed_amount: 250 })],
    });
    const transfer = rows.find((r) => r.kind === "transfer")!;
    expect(canReverse(transfer)).toBe(true);
    expect(transfer.transfer?.remaining).toBe(750);
  });

  it("stops offering Reverse once stacked partials cover the whole transfer", () => {
    const rows = buildTransactionFeed({
      ledger: [entry({})],
      sales: [],
      reversals: [
        reversal({ id: "r1", kind: "partial", reversed_amount: 250 }),
        reversal({ id: "r2", kind: "full", reversed_amount: 750 }),
      ],
    });
    const transfer = rows.find((r) => r.kind === "transfer")!;
    expect(canReverse(transfer)).toBe(false);
    expect(transfer.transfer?.status).toBe("reversed");
  });
});


describe("filterFeed", () => {
  const rows = buildTransactionFeed({ ledger: [entry({})], sales: [sale], reversals: [] });
  const nameFor = (id: string) => (id === "buyer" ? "Maria Cruz" : "Juan Dela Cruz");

  it("filters by kind", () => {
    expect(filterFeed(rows, "purchase", "", nameFor).every((r) => r.kind === "purchase")).toBe(true);
    expect(filterFeed(rows, "transfer", "", nameFor)).toHaveLength(1);
  });

  it("searches title, tx id and member name", () => {
    expect(filterFeed(rows, "all", "TX-S1", nameFor)).toHaveLength(1);
    expect(filterFeed(rows, "all", "maria", nameFor)).toHaveLength(1);
    expect(filterFeed(rows, "all", "nothing-here", nameFor)).toHaveLength(0);
  });
});

describe("canReverse guard", () => {
  it("rejects rows without transfer state", () => {
    const row = { kind: "transfer", transfer: null } as unknown as TxRow;
    expect(canReverse(row)).toBe(false);
  });
});
