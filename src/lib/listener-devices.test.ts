/**
 * The unmatched-payment helpers must call `rpc` on the Supabase client itself.
 * A detached `supabase.rpc` reference loses `this` and fails inside the client
 * with "Cannot read properties of undefined (reading 'rest')", which took down
 * the whole Approvals screen even when nothing was pending.
 */
import { describe, expect, it, vi } from "vitest";

const calls: { fn: string; self: unknown }[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const client = {
    rest: { marker: true },
    rpc(this: unknown, fn: string) {
      // Mirrors the real client: reading `this.rest` throws when unbound.
      const self = this as { rest?: unknown } | undefined;
      if (!self || !self.rest) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      calls.push({ fn, self });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { supabase: client };
});

const { dismissListenerEvent, fetchUnmatchedListenerEvents, linkListenerEvent } = await import(
  "./listener-devices"
);

describe("listener device rpc binding", () => {
  it("loads an empty unmatched queue without throwing", async () => {
    await expect(fetchUnmatchedListenerEvents()).resolves.toEqual([]);
    expect(calls.at(-1)?.fn).toBe("listener_unmatched_events");
  });

  it("keeps the client bound for link and dismiss", async () => {
    await expect(linkListenerEvent("event-1", "cash-in-1", "note")).resolves.toBeUndefined();
    await expect(dismissListenerEvent("event-1")).resolves.toBeUndefined();
    expect(calls.map((c) => c.fn)).toContain("link_listener_event");
    expect(calls.map((c) => c.fn)).toContain("dismiss_listener_event");
  });
});
