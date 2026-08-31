/**
 * Regression: the "1000 codes" incident.
 *
 * Calibrating/generating for "6 HOURS UNLIMITED PHP20" also produced a second
 * 500-code batch for "Pide Premium PHP20", because the Generate page asked the
 * server to check the WHOLE shop, which looped over every calibrated product.
 * These tests pin the absolute rule: one trigger touches exactly one product.
 */
import { describe, expect, it } from "vitest";
import { replenishProduct, type AdminClient } from "../voucher-replenishment.server";
import { defaultGenerationValues, type GenValue } from "../omada-generation";

type Row = Record<string, any>;

function makeAdmin(tables: Record<string, Row[]>) {
  let seq = 0;
  function query(name: string) {
    const rows = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let inserted: Row | null = null;
    let insertError: { message: string } | null = null;
    const matched = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (mode === "insert") return { data: inserted, error: insertError };
      if (mode === "update") {
        for (const r of matched()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      return { data: matched(), error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      insert: (values: Row) => {
        mode = "insert";
        if (name === "voucher_replenishment_runs") {
          const clash = rows.some(
            (r) =>
              r["ecosystem_id"] === values["ecosystem_id"] &&
              r["product_id"] === values["product_id"] &&
              ["queued", "running"].includes(r["status"]),
          );
          if (clash) {
            insertError = { message: "duplicate key value violates unique constraint" };
            return builder;
          }
        }
        seq += 1;
        inserted = { id: `${name}-${seq}`, created_at: new Date().toISOString(), ...values };
        rows.push(inserted);
        return builder;
      },
      update: (values: Row) => {
        mode = "update";
        payload = values;
        return builder;
      },
      maybeSingle: async () => {
        const res = run();
        return {
          data: mode === "select" ? ((res.data as Row[])[0] ?? null) : res.data,
          error: res.error,
        };
      },
      single: async () => {
        const res = run();
        return {
          data: mode === "select" ? ((res.data as Row[])[0] ?? null) : res.data,
          error: res.error,
        };
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return builder;
  }

  const admin: AdminClient = {
    from: (name: string) => query(name),
    rpc: async (fn: string, args: unknown) => {
      if (fn === "system_import_voucher_codes") {
        const a = args as { _ecosystem_id: string; _product_id: string; _codes: string[] };
        for (const code of a._codes) {
          (tables["voucher_codes"] ??= []).push({
            ecosystem_id: a._ecosystem_id,
            product_id: a._product_id,
            code: `${a._product_id}-${code}`,
            status: "unused",
            sold_to: null,
            sale_id: null,
          });
        }
        return { data: [{ batch_id: "import-1", imported_count: a._codes.length }], error: null };
      }
      return { data: null, error: null };
    },
  };
  return admin;
}

const base: Record<string, GenValue> = { ...defaultGenerationValues(), name: "seed", amount: 10 };

const SHOP = "shop-sagada";
const A = "prod-6h-unlimited-php20";
const B = "prod-pide-premium-php20";

function stock(product: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ecosystem_id: SHOP,
    product_id: product,
    code: `${product}-old-${i}`,
    status: "unused",
    sold_to: null,
    sale_id: null,
  }));
}

/** Both products share the same PHP20 price and similar rules on purpose. */
function world(opts: { availableA: number; availableB: number; calibrateB?: boolean }) {
  const tables: Record<string, Row[]> = {
    voucher_products: [
      { id: A, name: "6 HOURS UNLIMITED PHP20", ecosystem_id: SHOP },
      { id: B, name: "Pide Premium PHP20", ecosystem_id: SHOP },
    ],
    omada_voucher_calibrations: [
      {
        id: "cal-a",
        ecosystem_id: SHOP,
        product_id: A,
        version: 1,
        is_current: true,
        payload: { ...base, duration: 360, unitPrice: 20 },
      },
    ],
    voucher_codes: [...stock(A, opts.availableA), ...stock(B, opts.availableB)],
    voucher_replenishment_runs: [],
    omada_voucher_batches: [],
  };
  if (opts.calibrateB) {
    tables["omada_voucher_calibrations"]!.push({
      id: "cal-b",
      ecosystem_id: SHOP,
      product_id: B,
      version: 1,
      is_current: true,
      payload: { ...base, duration: 720, unitPrice: 20 },
    });
  }
  return tables;
}

function generator(seen: Array<{ groupName: string; payload: Record<string, unknown> }>) {
  return async (input: { payload: Record<string, unknown>; groupName: string }) => {
    seen.push(input);
    const amount = Number(input.payload["amount"] ?? 0);
    return {
      codes: Array.from({ length: amount }, (_, i) => `C${seen.length}-${i}`),
      groupId: `g-${seen.length}`,
      groupName: input.groupName,
      identity: {},
      response: {},
    };
  };
}

const count = (tables: Record<string, Row[]>, product: string) =>
  tables["voucher_codes"]!.filter((c) => c["product_id"] === product).length;

describe("voucher product isolation (1000-code incident)", () => {
  it("replenishing A creates exactly 500 codes for A and none for B", async () => {
    const tables = world({ availableA: 12, availableB: 5, calibrateB: true });
    const admin = makeAdmin(tables);
    const seen: Array<{ groupName: string; payload: Record<string, unknown> }> = [];
    const res = await replenishProduct(admin, { ecosystemId: SHOP, productId: A }, { generate: generator(seen) });

    expect(res).toMatchObject({ status: "completed", productId: A, imported: 500 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload["duration"]).toBe(360);
    expect(count(tables, A)).toBe(512);
    expect(count(tables, B)).toBe(5);
    expect(tables["voucher_replenishment_runs"]!.map((r) => r["product_id"])).toEqual([A]);
    expect(tables["omada_voucher_batches"]!.every((b) => b["product_id"] === A)).toBe(true);
  });

  it("B's calibration row is untouched by A's replenishment", async () => {
    const tables = world({ availableA: 0, availableB: 4, calibrateB: true });
    const before = JSON.stringify(
      tables["omada_voucher_calibrations"]!.find((c) => c["product_id"] === B),
    );
    await replenishProduct(makeAdmin(tables), { ecosystemId: SHOP, productId: A }, { generate: generator([]) });
    expect(
      JSON.stringify(tables["omada_voucher_calibrations"]!.find((c) => c["product_id"] === B)),
    ).toBe(before);
  });

  it("two concurrent checks for A still produce exactly 500 codes", async () => {
    const tables = world({ availableA: 0, availableB: 0, calibrateB: true });
    const admin = makeAdmin(tables);
    const seen: Array<{ groupName: string; payload: Record<string, unknown> }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (input: { payload: Record<string, unknown>; groupName: string }) => {
      await gate;
      return generator(seen)(input);
    };
    const first = replenishProduct(admin, { ecosystemId: SHOP, productId: A }, { generate: slow });
    const second = await replenishProduct(
      admin,
      { ecosystemId: SHOP, productId: A },
      { generate: generator(seen) },
    );
    release();
    await first;
    expect(second).toMatchObject({ status: "skipped", reason: "in_progress" });
    expect(count(tables, A)).toBe(500);
    expect(count(tables, B)).toBe(0);
  });

  it("B generates its own 500 only when B itself is low and calibrated", async () => {
    const tables = world({ availableA: 500, availableB: 3, calibrateB: true });
    const seen: Array<{ groupName: string; payload: Record<string, unknown> }> = [];
    const res = await replenishProduct(
      makeAdmin(tables),
      { ecosystemId: SHOP, productId: B },
      { generate: generator(seen) },
    );
    expect(res).toMatchObject({ status: "completed", productId: B, imported: 500 });
    expect(seen[0]?.payload["duration"]).toBe(720);
    expect(count(tables, A)).toBe(500);
    expect(count(tables, B)).toBe(503);
  });

  it("B without a calibration generates nothing, whatever A does", async () => {
    const tables = world({ availableA: 0, availableB: 0 });
    const admin = makeAdmin(tables);
    const seen: Array<{ groupName: string; payload: Record<string, unknown> }> = [];
    await replenishProduct(admin, { ecosystemId: SHOP, productId: A }, { generate: generator(seen) });
    const resB = await replenishProduct(admin, { ecosystemId: SHOP, productId: B }, { generate: generator(seen) });
    expect(resB).toMatchObject({ status: "skipped", reason: "no_calibration" });
    expect(count(tables, B)).toBe(0);
    expect(count(tables, A)).toBe(500);
  });
});
