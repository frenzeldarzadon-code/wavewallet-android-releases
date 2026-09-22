import { describe, expect, it } from "vitest";
import { amortizationSchedule, monthlyPayment, totalScheduledInterest, universeLoanStatusLabel } from "@/lib/universe-loans";

describe("Universe Loan previews", () => {
  it("uses reducing-balance amortization", () => {
    const rows = amortizationSchedule(10_000, 2, 3);
    expect(monthlyPayment(10_000, 2, 3)).toBe(3467.55);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.interest).toBe(200);
    expect(rows[1]?.interest).toBeLessThan(200);
    expect(rows[2]?.balance).toBe(0);
    expect(totalScheduledInterest(rows)).toBe(402.64);
  });

  it("uses clear lifecycle labels", () => {
    expect(universeLoanStatusLabel("partially_funded")).toBe("Partially funded");
    expect(universeLoanStatusLabel("early_paid")).toBe("Paid early");
  });
});