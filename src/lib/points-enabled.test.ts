/**
 * Reward points switch — data layer.
 *
 * The database is authoritative: it awards no points and charges the shop
 * admin 1 coin per would-be point while the switch is OFF. These tests only
 * pin the client contract the UI relies on — which RPCs are called, that a
 * read failure never hides a shop's Rewards Shop, and that saving surfaces a
 * readable error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { fetchPointsEnabled, setPointsEnabled } from "./rewards";

const ECO = "11111111-1111-1111-1111-111111111111";

beforeEach(() => rpc.mockReset());

describe("fetchPointsEnabled", () => {
  it("reads the shop switch through the shared RPC", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(fetchPointsEnabled(ECO)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("shop_points_enabled", { _ecosystem_id: ECO });
  });

  it("treats points as ON by default", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchPointsEnabled(ECO)).resolves.toBe(true);
  });

  it("never hides a Rewards Shop because of a read failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(fetchPointsEnabled(ECO)).resolves.toBe(true);
  });
});

describe("setPointsEnabled", () => {
  it("saves the new state and returns what the database stored", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(setPointsEnabled(ECO, false)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("set_points_enabled", {
      _ecosystem_id: ECO,
      _enabled: false,
    });
  });

  it("raises a readable error when the caller is not the shop admin", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not authorized" } });
    await expect(setPointsEnabled(ECO, true)).rejects.toThrow(/authoriz/i);
  });
});
