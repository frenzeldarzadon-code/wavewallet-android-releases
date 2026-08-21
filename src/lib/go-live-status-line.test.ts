import { describe, expect, it } from "vitest";
import { goLiveStatusLine } from "@/lib/go-live";

type Req = Parameters<typeof goLiveStatusLine>[0];
const req = (o: Record<string, unknown>) => o as unknown as NonNullable<Req>;

describe("goLiveStatusLine", () => {
  it("only claims the shop is live when the shop record says so", () => {
    expect(goLiveStatusLine(req({ status: "approved" }), true)).toContain("your shop is live");
  });

  it("never claims live while the shop is still persisted as Demo", () => {
    const line = goLiveStatusLine(req({ status: "approved" }), false);
    expect(line).not.toContain("your shop is live");
    expect(line).toContain("finishing activation");
  });

  it("reports the real pending reason", () => {
    expect(goLiveStatusLine(req({ status: "pending", auto_reason: "Waiting for GCash" }), false)).toBe(
      "Waiting for GCash",
    );
    expect(goLiveStatusLine(null)).toBe("No payment submitted yet.");
  });
});
