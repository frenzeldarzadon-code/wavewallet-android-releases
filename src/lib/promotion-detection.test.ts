import { describe, expect, it } from "vitest";
import {
  canPostAsRegular,
  detectPromotion,
  detectionExplanation,
  promotionGate,
} from "@/lib/promotion-detection";

describe("promotion detection", () => {
  it("leaves an ordinary personal post alone", () => {
    const d = detectPromotion("Good morning everyone! Beautiful sunrise here in Sagada today.");
    expect(d.level).toBe("none");
    expect(canPostAsRegular(d)).toBe(true);
  });

  it("does not flag a casual mention of a business or product", () => {
    const d = detectPromotion(
      "I just tried the new coffee shop near the plaza and honestly I recommend it.",
    );
    expect(d.level).toBe("none");
  });

  it("does not flag a photo on its own", () => {
    const d = detectPromotion("Family day at the falls", { hasImage: true });
    expect(d.level).toBe("none");
  });

  it("flags an explicit sale with a price as strong", () => {
    const d = detectPromotion("For sale: 100 wifi vouchers, PHP 20 each. DM me to order!");
    expect(d.level).toBe("strong");
    expect(canPostAsRegular(d)).toBe(false);
    expect(d.signals.length).toBeGreaterThan(0);
  });

  it("flags advertising language with a discount as strong", () => {
    const d = detectPromotion("PROMO! 50% off all load packages this week. Order now, free delivery.");
    expect(d.level).toBe("strong");
  });

  it("treats a single weak commercial word as borderline at most", () => {
    const d = detectPromotion("The new vouchers are available at the counter if anyone needs one.");
    expect(d.level).not.toBe("strong");
  });

  it("explains itself with the phrases it saw", () => {
    const d = detectPromotion("For sale: brand new router, P1500");
    expect(detectionExplanation(d)).toContain("We noticed");
  });

  it("pulls the score down for clearly personal wording", () => {
    const personal = detectPromotion(
      "Thank you sa lahat! I just bought a new phone and the price was worth it.",
    );
    expect(personal.level).toBe("none");
  });
});

describe("promotion gate", () => {
  const strong = detectPromotion("For sale: 100 vouchers, PHP 20 each. Order now!");
  const borderline = detectPromotion("Promo prices are available today at my shop");
  const clean = detectPromotion("Happy weekend everyone");

  it("requires a package for strong commercial content", () => {
    expect(
      promotionGate({
        detection: strong,
        promote: false,
        acknowledgedRegular: true,
        packagesAvailable: true,
      }),
    ).toBe("Choose a promotion package to publish this post.");
  });

  it("lets borderline content through once the member confirms", () => {
    const input = {
      detection: borderline,
      promote: false,
      acknowledgedRegular: false,
      packagesAvailable: true,
    };
    if (borderline.level === "possible") {
      expect(promotionGate(input)).not.toBeNull();
    }
    expect(promotionGate({ ...input, acknowledgedRegular: true })).toBeNull();
  });

  it("never blocks clean content", () => {
    expect(
      promotionGate({
        detection: clean,
        promote: false,
        acknowledgedRegular: false,
        packagesAvailable: true,
      }),
    ).toBeNull();
  });

  it("never blocks when the explicit promote toggle is on", () => {
    expect(
      promotionGate({
        detection: strong,
        promote: true,
        acknowledgedRegular: false,
        packagesAvailable: true,
      }),
    ).toBeNull();
  });

  it("never blocks when no promotion package exists to choose", () => {
    expect(
      promotionGate({
        detection: strong,
        promote: false,
        acknowledgedRegular: false,
        packagesAvailable: false,
      }),
    ).toBeNull();
  });
});
