import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal browser surface: the queue only needs localStorage, an event target
// and navigator.onLine. This keeps the suite on the plain node environment.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as unknown as { window: unknown }).window = {
  localStorage: memoryStorage,
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
if (!("navigator" in globalThis)) {
  (globalThis as unknown as { navigator: unknown }).navigator = { onLine: true };
}
(globalThis as unknown as { Event: unknown }).Event ??= class {
  constructor(public type: string) {}
};
import {
  enqueueEntry,
  flushQueue,
  newClientRef,
  queueFor,
  queuedAsEntries,
  queuedInPeriod,
  readQueue,
  removeQueuedEntry,
  updateQueuedEntry,
  type QueuedEntry,
} from "@/lib/offline-spending";

const base = (over: Partial<QueuedEntry> = {}) => ({
  clientRef: over.clientRef ?? newClientRef(),
  ecosystemId: over.ecosystemId ?? "shop-1",
  kind: over.kind ?? ("expense" as const),
  amount: over.amount ?? 250,
  description: over.description ?? "Internet bill",
  categoryId: over.categoryId ?? null,
  categoryName: over.categoryName ?? null,
  occurredAt: over.occurredAt ?? "2026-08-20T04:00:00.000Z",
  notes: over.notes ?? null,
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  setOnline(true);
});

describe("offline manual entry queue", () => {
  it("persists queued entries across reloads and scopes them to one shop", () => {
    enqueueEntry(base());
    enqueueEntry(base({ ecosystemId: "shop-2" }));
    // A fresh read is what a restarted app does.
    expect(readQueue()).toHaveLength(2);
    expect(queueFor("shop-1")).toHaveLength(1);
    expect(queueFor(null)).toHaveLength(0);
  });

  it("shows queued rows locally, always flagged as not yet synced", () => {
    const q = enqueueEntry(base({ amount: 40, kind: "income", description: "Rebate" }));
    const [row] = queuedAsEntries([q]);
    expect(row).toMatchObject({ amount: 40, kind: "income", sync: "pending", editable: true });
    expect(row?.source).toBe("manual");
  });

  it("filters queued rows by the selected reporting period", () => {
    const q = enqueueEntry(base({ occurredAt: "2026-08-20T04:00:00.000Z" }));
    const inside = queuedInPeriod([q], new Date("2026-08-01"), new Date("2026-08-31T23:59:59.999Z"));
    const outside = queuedInPeriod([q], new Date("2026-09-01"), new Date("2026-09-30"));
    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
  });

  it("never syncs while offline and keeps the queue intact", async () => {
    enqueueEntry(base());
    setOnline(false);
    const send = vi.fn();
    const result = await flushQueue("shop-1", send as never);
    expect(result).toEqual({ synced: 0, failed: 0, skipped: true });
    expect(send).not.toHaveBeenCalled();
    expect(readQueue()).toHaveLength(1);
  });

  it("sends the client reference and clears the item only after the server confirms", async () => {
    const q = enqueueEntry(base());
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await flushQueue("shop-1", send as never);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ clientRef: q.clientRef, amount: 250 });
    expect(result.synced).toBe(1);
    expect(readQueue()).toHaveLength(0);
  });

  it("reuses the same client reference on retry, so a replay cannot duplicate", async () => {
    const q = enqueueEntry(base());
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);

    const first = await flushQueue("shop-1", send as never);
    expect(first).toMatchObject({ synced: 0, failed: 1 });
    expect(readQueue()[0]).toMatchObject({ attempts: 1, lastError: "network down" });
    expect(queuedAsEntries(readQueue())[0]?.sync).toBe("failed");

    const second = await flushQueue("shop-1", send as never);
    expect(second.synced).toBe(1);
    expect(send.mock.calls.map((c) => (c[0] as { clientRef: string }).clientRef)).toEqual([
      q.clientRef,
      q.clientRef,
    ]);
    expect(readQueue()).toHaveLength(0);
  });

  it("edits and removes an entry that has not been sent yet", () => {
    const q = enqueueEntry(base());
    updateQueuedEntry(q.clientRef, { amount: 300, description: "Internet + cable" });
    expect(readQueue()[0]).toMatchObject({
      clientRef: q.clientRef,
      amount: 300,
      description: "Internet + cable",
    });
    removeQueuedEntry(q.clientRef);
    expect(readQueue()).toHaveLength(0);
  });

  it("only touches the requested shop when flushing", async () => {
    enqueueEntry(base({ ecosystemId: "shop-1" }));
    enqueueEntry(base({ ecosystemId: "shop-2" }));
    const send = vi.fn().mockResolvedValue(undefined);
    await flushQueue("shop-1", send as never);
    expect(readQueue().map((r) => r.ecosystemId)).toEqual(["shop-2"]);
  });
});
