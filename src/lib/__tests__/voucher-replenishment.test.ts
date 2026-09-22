/**
 * Automatic Voucher Shop replenishment.
 *
 * Proves the product-scoped calibration rule, the exact low-stock threshold,
 * concurrency safety, shop isolation and that generated codes land in the
 * shop's Voucher Shop stock through the existing import rules.
 */
import { describe, expect, it } from "vitest";
import {
  availableStock,
  decideReplenishment,
  replenishmentPayload,
  LOW_STOCK_THRESHOLD,
  REPLENISH_BATCH_SIZE,
} from "../voucher-replenishment";
import { replenishProduct, sweepReplenishments, type AdminClient } from "../voucher-replenishment.server";
import { defaultGenerationValues, type GenValue } from "../omada-generation";

type Row = Record<string, any>;

/** Tiny in-memory stand-in for the service-role client this job uses. */
function makeAdmin(tables: Record<string, Row[]>) {
  let seq = 0;
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  function query(name: string) {
    const rows = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let inserted: Row | null = null;
    let insertError: { message: string } | null = null;
    let order: { column: string; asc: boolean } | null = null;
    let limit: number | null = null;

    const matched = () => rows.filter((r) => filters.every((f) => f(r)));

    const run = () => {
      if (mode === "insert") return { data: inserted, error: insertError };
      if (mode === "update") {
        for (const r of matched()) Object.assign(r, payload);
        return { data: null, error: null };
      }
      let out = matched();
      if (order) {
        out = [...out].sort((a, b) =>
          order!.asc
            ? String(a[order!.column]).localeCompare(String(b[order!.column]))
            : String(b[order!.column]).localeCompare(String(a[order!.column])),
        );
      }
      if (limit !== null) out = out.slice(0, limit);
      return { data: out, error: null };
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
      order: (column: string, opts?: { ascending?: boolean }) => {
        order = { column, asc: opts?.ascending !== false };
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      insert: (values: Row) => {
        mode = "insert";
        // Mirrors the partial unique index: one active run per shop + product.
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
        return { data: mode === "select" ? ((res.data as Row[])[0] ?? null) : res.data, error: res.error };
      },
      single: async () => {
        const res = run();
        return { data: mode === "select" ? ((res.data as Row[])[0] ?? null) : res.data, error: res.error };
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return builder;
  }

  const admin: AdminClient & { rpcCalls: typeof rpcCalls } = {
    from: (name: string) => query(name),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "claim_voucher_replenishment_event") {
        const a = args as Record<string, any>;
        const states = (tables["voucher_replenishment_states"] ??= []);
        let state = states.find((r) => r.ecosystem_id === a["_ecosystem_id"] && r.product_id === a["_product_id"]);
        if (a["_available"] >= LOW_STOCK_THRESHOLD) {
          if (state) Object.assign(state, { low_stock_active: false, status: "ready", attempts: 0, group_id: null, group_name: null });
          return { data: [{ claimed: false, reason: "stocked", run_id: null, event_number: state?.event_number ?? 0, group_name: null }], error: null };
        }
        if (state?.low_stock_active && state["status"] === "completed") return { data: [{ claimed: false, reason: "event_completed", run_id: state["run_id"], event_number: state["event_number"], group_name: state["group_name"] }], error: null };
        if (state?.status === "running") return { data: [{ claimed: false, reason: "in_progress", run_id: state["run_id"], event_number: state["event_number"], group_name: state["group_name"] }], error: null };
        if (state?.status === "paused") return { data: [{ claimed: false, reason: "event_paused", run_id: state["run_id"], event_number: state["event_number"], group_name: state["group_name"] }], error: null };
        seq += 1;
        const runId = `run-${seq}`;
        (tables["voucher_replenishment_runs"] ??= []).push({ id: runId, ecosystem_id: a["_ecosystem_id"], product_id: a["_product_id"], status: "running", requested_count: 500, created_at: a["_now"] });
        state = { ecosystem_id: a["_ecosystem_id"], product_id: a["_product_id"], event_number: (state?.event_number ?? 0) + 1, low_stock_active: true, status: "running", run_id: runId, group_name: a["_group_name"], group_id: null, attempts: 1 };
        const old = states.findIndex((r) => r.ecosystem_id === a["_ecosystem_id"] && r.product_id === a["_product_id"]);
        if (old >= 0) states[old] = state; else states.push(state);
        return { data: [{ claimed: true, reason: "claimed", run_id: runId, event_number: state["event_number"], group_name: state["group_name"] }], error: null };
      }
      if (fn === "finish_voucher_replenishment_event") {
        const a = args as Record<string, any>;
        const state = (tables["voucher_replenishment_states"] ?? []).find((r) => r.ecosystem_id === a["_ecosystem_id"] && r.product_id === a["_product_id"]);
        if (state) Object.assign(state, { status: a["_success"] ? "completed" : "paused", group_id: a["_group_id"], group_name: a["_group_name"], generated_count: a["_generated"], imported_count: a["_imported"], error: a["_error"] });
        const run = (tables["voucher_replenishment_runs"] ?? []).find((r) => r.id === a["_run_id"]);
        if (run) Object.assign(run, { status: a["_success"] ? "completed" : "failed", generated_count: a["_generated"], imported_count: a["_imported"], error: a["_error"] });
        return { data: null, error: null };
      }
      if (fn === "system_import_voucher_codes") {
        const a = args as { _ecosystem_id: string; _product_id: string; _codes: string[] };
        for (const code of a["_codes"]) {
          (tables["voucher_codes"] ??= []).push({
            ecosystem_id: a["_ecosystem_id"],
            product_id: a["_product_id"],
            code,
            status: "unused",
            sold_to: null,
            sale_id: null,
          });
        }
        return {
          data: [{ batch_id: "import-1", imported_count: a["_codes"].length }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    rpcCalls,
  };
  return admin;
}

const calibrationPayload: Record<string, GenValue> = {
  ...defaultGenerationValues(),
  name: "seed",
  amount: 10,
};

function codes(count: number, ecosystem: string, product: string, extra: Row = {}) {
  return Array.from({ length: count }, (_, i) => ({
    ecosystem_id: ecosystem,
    product_id: product,
    code: `${product}-${i}`,
    status: "unused",
    sold_to: null,
    sale_id: null,
    ...extra,
  }));
}

function world(options: { availableA?: number; calibrateA?: boolean; calibrateB?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    voucher_products: [
      { id: "prod-a", name: "1 Day", ecosystem_id: "shop-1" },
      { id: "prod-b", name: "3 Days", ecosystem_id: "shop-1" },
      { id: "prod-c", name: "1 Day", ecosystem_id: "shop-2" },
    ],
    omada_voucher_calibrations: [],
    voucher_codes: codes(options.availableA ?? 0, "shop-1", "prod-a"),
    voucher_replenishment_runs: [],
    voucher_replenishment_states: [],
    omada_voucher_batches: [],
    voucher_imports: [],
  };
  if (options.calibrateA !== false) {
    tables["omada_voucher_calibrations"]!.push({
      id: "cal-a",
      ecosystem_id: "shop-1",
      product_id: "prod-a",
      version: 3,
      is_current: true,
      payload: { ...calibrationPayload, duration: 1440 },
    });
  }
  if (options.calibrateB) {
    tables["omada_voucher_calibrations"]!.push({
      id: "cal-b",
      ecosystem_id: "shop-1",
      product_id: "prod-b",
      version: 1,
      is_current: true,
      payload: { ...calibrationPayload, duration: 4320 },
    });
  }
  return tables;
}

function fakeGenerate(seen: Array<{ payload: Record<string, unknown>; groupName: string }>) {
  return async (input: { payload: Record<string, unknown>; groupName: string }) => {
    seen.push(input);
    const amount = Number(input.payload["amount"] ?? 0);
    return {
      codes: Array.from({ length: amount }, (_, i) => `NEW${String(i).padStart(5, "0")}`),
      groupId: "group-1",
      groupName: input.groupName,
      identity: { baseUrl: "https://c", omadacId: "o", siteId: "s", controllerVersion: "6.2" },
      response: {},
    };
  };
}

describe("voucher shop availability", () => {
  it("counts only uncommitted codes as available stock", () => {
    expect(
      availableStock([
        { status: "unused", sold_to: null, sale_id: null },
        { status: "unused", sold_to: "buyer", sale_id: null },
        { status: "sold", sold_to: "buyer", sale_id: "sale" },
        { status: "unused", sold_to: null, sale_id: "sale" },
      ]),
    ).toBe(1);
  });

  it("replenishes below the threshold and does nothing at or above it", () => {
    expect(decideReplenishment({ available: 99, hasCalibration: true, runInProgress: false })).toMatchObject({
      replenish: true,
      amount: REPLENISH_BATCH_SIZE,
    });
    expect(
      decideReplenishment({ available: LOW_STOCK_THRESHOLD, hasCalibration: true, runInProgress: false })
        .replenish,
    ).toBe(false);
    expect(decideReplenishment({ available: 0, hasCalibration: false, runInProgress: false })).toMatchObject({
      replenish: false,
      reason: "no_calibration",
    });
  });

  it("keeps every existing voucher rule and only sets the batch size and name", () => {
    const payload = replenishmentPayload({ ...calibrationPayload, duration: 1440 }, "1 Day 2026-01-01");
    expect(payload["duration"]).toBe(1440);
    expect(payload["codeLength"]).toBe(calibrationPayload["codeLength"]);
    expect(payload["limitType"]).toBe(calibrationPayload["limitType"]);
    expect(payload["amount"]).toBe(REPLENISH_BATCH_SIZE);
    expect(payload["name"]).toBe("1 Day 2026-01-01");
  });

  it("sends the saved data cap to Omada exactly as stored, with no second conversion", () => {
    // The calibration is stored in the controller's own units (MB). A 5 GB
    // product was saved as 5120 and must leave as 5120.
    const payload = replenishmentPayload(
      { ...calibrationPayload, trafficLimitEnable: true, trafficLimit: 5120 },
      "5 GB 2026-01-01",
    );
    expect(payload["trafficLimit"]).toBe(5120);
    expect(payload["trafficLimitEnable"]).toBe(true);
  });
});

describe("automatic replenishment", () => {
  it("A: a calibrated product with 99 codes gets exactly one 500-code batch", async () => {
    const tables = world({ availableA: 99 });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    const res = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-a" },
      { generate: fakeGenerate(seen) },
    );
    expect(res.status).toBe("completed");
    expect(res.imported).toBe(500);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload["amount"]).toBe(500);
    expect(seen[0]?.payload["duration"]).toBe(1440);
    expect(tables["voucher_replenishment_runs"]).toHaveLength(1);
  });

  it("E: stock at 100 triggers nothing", async () => {
    const admin = makeAdmin(world({ availableA: 100 }));
    const seen: never[] = [];
    const res = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-a" },
      { generate: fakeGenerate(seen as never) },
    );
    expect(res).toMatchObject({ status: "skipped", reason: "stocked" });
    expect(seen).toHaveLength(0);
  });

  it("F: empty stock with a calibration produces one 500-code batch", async () => {
    const tables = world({ availableA: 0 });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    const res = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-a" },
      { generate: fakeGenerate(seen) },
    );
    expect(res.imported).toBe(500);
    expect(seen).toHaveLength(1);
  });

  it("B/C/G: an uncalibrated product never generates and never borrows another calibration", async () => {
    const tables = world({ availableA: 99, calibrateA: true });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    const res = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-b" },
      { generate: fakeGenerate(seen) },
    );
    expect(res).toMatchObject({ status: "skipped", reason: "no_calibration" });
    expect(seen).toHaveLength(0);
    expect(tables["voucher_replenishment_runs"]).toHaveLength(0);
  });

  it("C: each product generates with its own calibration only", async () => {
    const tables = world({ availableA: 0, calibrateB: true });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    await replenishProduct(admin, { ecosystemId: "shop-1", productId: "prod-a" }, { generate: fakeGenerate(seen) });
    await replenishProduct(admin, { ecosystemId: "shop-1", productId: "prod-b" }, { generate: fakeGenerate(seen) });
    expect(seen.map((s) => s.payload["duration"])).toEqual([1440, 4320]);
  });

  it("H: a second concurrent check cannot create a second batch", async () => {
    const tables = world({ availableA: 0 });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = async (input: { payload: Record<string, unknown>; groupName: string }) => {
      await gate;
      return fakeGenerate(seen)(input);
    };
    const first = replenishProduct(admin, { ecosystemId: "shop-1", productId: "prod-a" }, { generate: slow });
    const second = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-a" },
      { generate: fakeGenerate(seen) },
    );
    release();
    const firstResult = await first;
    expect(firstResult.status).toBe("completed");
    expect(second).toMatchObject({ status: "skipped", reason: "in_progress" });
    expect(seen).toHaveLength(1);
    expect(tables["voucher_replenishment_runs"]).toHaveLength(1);
  });

  it("I: generated codes enter the Voucher Shop stock through the existing import rules", async () => {
    const tables = world({ availableA: 10 });
    const admin = makeAdmin(tables);
    await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-a" },
      { generate: fakeGenerate([]) },
    );
    expect((admin as never as { rpcCalls: Array<{ fn: string }> }).rpcCalls.map((call) => call.fn)).toContain(
      "system_import_voucher_codes",
    );
    const stock = tables["voucher_codes"]!.filter(
      (c) => c["ecosystem_id"] === "shop-1" && c["product_id"] === "prod-a",
    );
    expect(availableStock(stock as never)).toBe(510);
  });

  it("K: a product from another shop (or a deleted one) never generates", async () => {
    const admin = makeAdmin(world({ availableA: 0 }));
    const result = await replenishProduct(
      admin,
      { ecosystemId: "shop-1", productId: "prod-c" },
      { generate: fakeGenerate([]) },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("product_deleted");
  });
});

describe("scheduled background sweep", () => {
  it("L: tops up every shop's calibrated products with no UI involved", async () => {
    const tables = world({ availableA: 10, calibrateB: true });
    tables["voucher_codes"]!.push(...codes(150, "shop-1", "prod-b"));
    tables["omada_voucher_calibrations"]!.push({
      id: "cal-c",
      ecosystem_id: "shop-2",
      product_id: "prod-c",
      version: 1,
      is_current: true,
      payload: { ...calibrationPayload },
    });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    const summary = await sweepReplenishments(admin, { generate: fakeGenerate(seen) });

    expect(summary.shops).toBe(2);
    expect(summary.checked).toBe(3);
    // Only the two low-stock products generate; the 150-code product does not.
    expect(summary.replenished).toBe(2);
    expect(seen).toHaveLength(2);
    // Every calibrated product records that the background job looked at it.
    for (const cal of tables["omada_voucher_calibrations"]!) {
      expect(cal["last_auto_check_at"]).toBeTruthy();
    }
  });

  it("M: a controller failure is paused and later sweeps do not create duplicate groups", async () => {
    const tables = world({ availableA: 5 });
    const admin = makeAdmin(tables);
    const failing = async () => {
      throw new Error("Omada rate limit");
    };
    const first = await sweepReplenishments(admin, { generate: failing as never });
    expect(first.failed).toBe(1);
    const run = tables["voucher_replenishment_runs"]![0]!;
    expect(run["status"]).toBe("failed");
    expect(run["error"]).toContain("Omada rate limit");
    expect(tables["voucher_codes"]!.length).toBe(5);

    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    const second = await sweepReplenishments(admin, { generate: fakeGenerate(seen) });
    expect(second.replenished).toBe(0);
    expect(tables["voucher_codes"]!.length).toBe(5);
    expect(seen).toHaveLength(0);
  });

  it("N: a completed event stays latched until stock recovers, then a later low crossing gets one new batch", async () => {
    const tables = world({ availableA: 99 });
    const admin = makeAdmin(tables);
    const seen: Array<{ payload: Record<string, unknown>; groupName: string }> = [];
    await sweepReplenishments(admin, { generate: fakeGenerate(seen) });
    expect(tables["voucher_codes"]).toHaveLength(599);

    tables["voucher_codes"]!.splice(0, 500);
    const stillSameEvent = await sweepReplenishments(admin, { generate: fakeGenerate(seen) });
    expect(stillSameEvent.replenished).toBe(0);
    expect(seen).toHaveLength(1);

    tables["voucher_codes"]!.push(...codes(1, "shop-1", "prod-a", { code: "rearm" }));
    await sweepReplenishments(admin, { generate: fakeGenerate(seen) });
    tables["voucher_codes"]!.splice(0, 1);
    const nextEvent = await sweepReplenishments(admin, { generate: fakeGenerate(seen) });
    expect(nextEvent.replenished).toBe(1);
    expect(seen).toHaveLength(2);
  });
});
