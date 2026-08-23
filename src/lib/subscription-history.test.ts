import { describe, expect, it } from "vitest";
import {
  historyDetail,
  historySource,
  historyTitle,
  historyTone,
  type SubscriptionHistoryRow,
} from "./subscription-history";
import { coveragePeriod, planTotalPhp } from "./subscription-duration";

const row = (patch: Partial<SubscriptionHistoryRow>): SubscriptionHistoryRow => ({
  id: "1",
  occurred_at: "2026-08-01T00:00:00Z",
  source: "subscription",
  event_type: "renewal",
  previous_plan_name: null,
  new_plan_name: null,
  amount_php: null,
  coins: null,
  period_start: null,
  period_end: null,
  reference: null,
  actor_name: null,
  detail: null,
  ...patch,
});

describe("subscription history wording", () => {
  it("names activations, renewals/extensions and plan changes", () => {
    expect(historyTitle(row({ event_type: "activation", new_plan_name: "Standard" }))).toContain(
      "Subscription activated",
    );
    expect(historyTitle(row({ event_type: "renewal", new_plan_name: "Standard" }))).toContain(
      "Renewal / extension",
    );
    expect(
      historyTitle(
        row({ event_type: "upgrade", previous_plan_name: "Starter", new_plan_name: "Standard" }),
      ),
    ).toBe("Plan changed — Starter → Standard");
  });

  it("shows Super Admin manual extensions and credits with their source", () => {
    const ext = row({ source: "adjustment", event_type: "super_admin_extension" });
    expect(historyTitle(ext)).toBe("Extended by WaveWallet");
    expect(historySource(ext)).toBe("WaveWallet manual extension");

    const credit = row({ source: "platform_credit", event_type: "super_admin_credit", coins: 500 });
    expect(historyTitle(credit)).toBe("Coins issued by WaveWallet");
    expect(historySource(credit)).toBe("WaveWallet manual credit");
    expect(historyTone(credit)).toBe("brand");
  });

  it("labels a zero-priced entry as needing no payment", () => {
    expect(historySource(row({ amount_php: 0 }))).toBe("No payment required");
    expect(historySource(row({ amount_php: 150 }))).toBe("Payment");
  });

  it("hides internal bookkeeping notes from the operator but keeps them for the owner", () => {
    const r = row({ detail: "SUBSCRIPTION_PAYMENT — not a cash in, not a coin transfer" });
    expect(historyDetail(r, "operator")).toBeNull();
    expect(historyDetail(r, "owner")).toContain("SUBSCRIPTION_PAYMENT");
    expect(historyDetail(row({ detail: "Courtesy extension" }), "operator")).toBe(
      "Courtesy extension",
    );
  });
});

describe("renew / extend / change maths reuse the configured plan price", () => {
  it("renewal of 1 month costs one monthly price", () => {
    expect(planTotalPhp(150, 1)).toBe(150);
  });

  it("extension multiplies the same configured price by the months chosen", () => {
    expect(planTotalPhp(150, 6)).toBe(900);
  });

  it("an extension is appended to a period that is still running", () => {
    const now = new Date("2026-08-23T00:00:00Z");
    const c = coveragePeriod("2026-09-23T00:00:00Z", 3, now);
    expect(c.extendsExisting).toBe(true);
    expect(c.end.getUTCMonth()).toBe(11); // Sep + 3 months = Dec
  });

  it("a zero-priced plan stays free for any duration", () => {
    expect(planTotalPhp(0, 12)).toBe(0);
  });
});
