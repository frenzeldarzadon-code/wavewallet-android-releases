/**
 * Rewards Shop tenant isolation.
 *
 * A member can belong to several shops. Their points wallet, points history,
 * reward catalog and redemption history must be resolved per ecosystem, exactly
 * like the Voucher Shop. These tests drive the data layer against a fake
 * Supabase client that stores rows for two shops and only answers with the rows
 * matching the filters the helper actually applied — so a missing
 * `ecosystem_id` filter shows up as Shop A data leaking into Shop B.
 */
import { describe, expect, it, vi } from "vitest";

const SHOP_A = "eco-a";
const SHOP_B = "eco-b";
const USER = "user-1";

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  points_accounts: [
    { user_id: USER, ecosystem_id: SHOP_A, balance: 120, held: 20 },
    { user_id: USER, ecosystem_id: SHOP_B, balance: 5, held: 0 },
  ],
  points_ledger: [
    { id: "l-a", user_id: USER, ecosystem_id: SHOP_A, amount: 120, direction: "credit", created_at: "2026-01-01" },
    { id: "l-b", user_id: USER, ecosystem_id: SHOP_B, amount: 5, direction: "credit", created_at: "2026-01-02" },
  ],
  reward_products: [
    { id: "r-a", ecosystem_id: SHOP_A, name: "Shop A mug", created_at: "2026-01-01" },
    { id: "r-b", ecosystem_id: SHOP_B, name: "Shop B cap", created_at: "2026-01-02" },
  ],
  reward_redemptions: [
    { id: "d-a", user_id: USER, ecosystem_id: SHOP_A, reward_name: "Shop A mug", created_at: "2026-01-01" },
    { id: "d-b", user_id: USER, ecosystem_id: SHOP_B, reward_name: "Shop B cap", created_at: "2026-01-02" },
  ],
};

const rpcCalls: { fn: string; args: unknown }[] = [];

function builder(table: string) {
  const filters: { column: string; value: unknown }[] = [];
  const nullFilters: string[] = [];
  const rows = () =>
    (tables[table] ?? []).filter(
      (r) =>
        filters.every((f) => r[f.column] === f.value) &&
        nullFilters.every((c) => r[c] === null || r[c] === undefined),
    );
  const api: Record<string, unknown> = {
    select: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: rows(), error: null }),
    eq: (column: string, value: unknown) => {
      filters.push({ column, value });
      return api;
    },
    is: (column: string) => {
      nullFilters.push(column);
      return api;
    },
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
  };
  return api;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rest: {},
    from: (table: string) => builder(table),
    rpc(this: unknown, fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: [], error: null });
    },
  },
}));

const {
  fetchEcosystemRedemptions,
  fetchMyRedemptions,
  fetchPointsAccount,
  fetchPointsLedger,
  fetchRewardProducts,
} = await import("./rewards");

describe("rewards shop is isolated per shop", () => {
  it("reads a separate points balance in each shop", async () => {
    await expect(fetchPointsAccount(USER, SHOP_A)).resolves.toEqual({
      balance: 120,
      held: 20,
      available: 100,
    });
    await expect(fetchPointsAccount(USER, SHOP_B)).resolves.toEqual({
      balance: 5,
      held: 0,
      available: 5,
    });
  });

  it("never shows another shop's points history", async () => {
    const inB = await fetchPointsLedger(USER, SHOP_B);
    expect(inB.map((e) => e.id)).toEqual(["l-b"]);
  });

  it("lists only the current shop's reward catalog", async () => {
    const catalog = await fetchRewardProducts(SHOP_B);
    expect(catalog.map((r) => r.id)).toEqual(["r-b"]);
  });

  it("lists only the current shop's redemption history", async () => {
    const mineInB = await fetchMyRedemptions(USER, SHOP_B);
    expect(mineInB.map((r) => r.id)).toEqual(["d-b"]);
    const mineInA = await fetchMyRedemptions(USER, SHOP_A);
    expect(mineInA.map((r) => r.id)).toEqual(["d-a"]);
  });

  it("returns nothing rather than every shop when no shop is selected", async () => {
    await expect(fetchMyRedemptions(USER, null)).resolves.toEqual([]);
  });

  it("asks the database for staff redemptions of one explicit shop", async () => {
    await fetchEcosystemRedemptions(SHOP_B);
    expect(rpcCalls.at(-1)).toEqual({
      fn: "list_ecosystem_redemptions",
      args: { _ecosystem_id: SHOP_B },
    });
  });
});
