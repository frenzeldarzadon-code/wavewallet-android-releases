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

describe("profileSaveIssue", () => {
  const base = { name: "Maria Dela Cruz", handle: "maria_dc", hasFile: false, hasCrop: false };

  it("allows a valid save", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handleState: "available" })).toBeNull();
  });

  it("allows an unchanged handle (idle state)", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handleState: "idle" })).toBeNull();
  });

  it("allows an empty optional handle", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handle: "", handleState: "idle" })).toBeNull();
  });

  it("saves even when availability could not be checked", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handleState: "unknown" })).toBeNull();
  });

  it("blocks a genuinely taken handle with a clear explanation", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handleState: "taken" })).toMatch(/already used by another/);
  });

  it("blocks a malformed handle and a missing name", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handle: "no spaces", handleState: "idle" })).toMatch(
      /letters, numbers/,
    );
    expect(profileSaveIssue({ ...base, name: "  ", handleState: "idle" })).toMatch(/required/);
  });

  it("waits for a picked photo to finish loading", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(
      profileSaveIssue({ ...base, handleState: "available", hasFile: true, hasCrop: false }),
    ).toMatch(/still loading/);
    expect(
      profileSaveIssue({ ...base, handleState: "available", hasFile: true, hasCrop: true }),
    ).toBeNull();
  });

  it("waits while a check is still running", async () => {
    const { profileSaveIssue } = await import("./profile");
    expect(profileSaveIssue({ ...base, handleState: "checking" })).toMatch(/checking/i);
  });
});

describe("avatar paths", () => {
  it("stores shop photos under the shop folder and platform photos under 'platform'", async () => {
    const { avatarPathFor } = await import("./profile");
    expect(avatarPathFor("eco-1", "user-1", "image/webp")).toMatch(/^eco-1\/user-1\/.+\.webp$/);
    expect(avatarPathFor(null, "user-1", "image/webp")).toMatch(/^platform\/user-1\/.+\.webp$/);
  });
});
