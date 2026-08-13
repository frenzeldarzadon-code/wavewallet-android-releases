import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { checkHandle } = await import("./profile");

describe("checkHandle", () => {
  beforeEach(() => rpc.mockReset());

  it("reports a free handle as available", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkHandle("newhandle")).toBe("available");
  });

  it("reports a handle used by another member as taken", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkHandle("takenone")).toBe("taken");
  });

  it("treats the member's own handle as available without asking the server", async () => {
    expect(await checkHandle(" @MineOwn ", "mineown")).toBe("available");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes case, whitespace and @ before checking", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await checkHandle("  @Maria_DC ");
    expect(rpc).toHaveBeenCalledWith("handle_available", { _handle: "maria_dc" });
  });

  it("treats an empty handle as nothing to check", async () => {
    expect(await checkHandle("   ")).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never turns a failed check into a false 'taken'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    expect(await checkHandle("newhandle")).toBe("unknown");
  });
});
