import { describe, expect, it } from "vitest";
import { describeGoLiveRequest, goLiveStatusWeight } from "@/lib/go-live-status";

const base = {
  status: "pending",
  proof_path: "u/1.jpg",
  payer_number_key: "639171234567",
  auto_state: "pending",
  auto_reason: null,
  receipt_check: "pending",
  listener_event_id: null,
};

describe("describeGoLiveRequest", () => {
  it("shows automatic activation with no action required", () => {
    const s = describeGoLiveRequest({ ...base, status: "approved", listener_event_id: "e1" });
    expect(s.kind).toBe("activated");
    expect(s.actionRequired).toBe(false);
  });

  it("separates a manual approval from a listener activation", () => {
    expect(describeGoLiveRequest({ ...base, status: "approved" }).kind).toBe("approved_manually");
  });

  it("says it is waiting for the listener rather than awaiting approval", () => {
    const s = describeGoLiveRequest(base);
    expect(s.kind).toBe("waiting");
    expect(s.badge).toMatch(/Waiting for payment listener/i);
    expect(s.actionRequired).toBe(false);
  });

  it("flags ambiguity as manual review with the engine reason", () => {
    const s = describeGoLiveRequest({
      ...base,
      auto_state: "ambiguous",
      auto_reason: "More than one GCash notification matches",
    });
    expect(s.kind).toBe("review");
    expect(s.detail).toMatch(/More than one/);
    expect(s.fix).toBeTruthy();
  });

  it("explains an already-consumed payment", () => {
    const s = describeGoLiveRequest({
      ...base,
      auto_reason: "The matching GCash notification was already used elsewhere",
    });
    expect(s.badge).toMatch(/already used/i);
    expect(s.actionRequired).toBe(true);
  });

  it("explains missing proof and where to fix it", () => {
    const s = describeGoLiveRequest({ ...base, proof_path: null });
    expect(s.kind).toBe("invalid");
    expect(s.fix).toMatch(/Go Live/);
  });

  it("explains an incomplete request with no sending number", () => {
    expect(describeGoLiveRequest({ ...base, payer_number_key: null }).kind).toBe("invalid");
  });

  it("raises a receipt mismatch for review", () => {
    const s = describeGoLiveRequest({ ...base, receipt_check: "mismatch" });
    expect(s.kind).toBe("review");
    expect(s.note).toMatch(/reference read/i);
  });

  it("surfaces rejection reasons", () => {
    const s = describeGoLiveRequest({
      ...base,
      status: "rejected",
      decision_reason: "Wrong amount",
    });
    expect(s.detail).toBe("Wrong amount");
  });

  it("sorts action-needed states first", () => {
    const review = describeGoLiveRequest({ ...base, auto_state: "ambiguous" });
    const waiting = describeGoLiveRequest(base);
    expect(goLiveStatusWeight(review)).toBeLessThan(goLiveStatusWeight(waiting));
  });
});
