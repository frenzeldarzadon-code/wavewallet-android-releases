/**
 * Lightweight, explainable promotion detection for Universe posts.
 *
 * This is a *conservative* text heuristic, not a moderation system. It runs
 * entirely in the browser, costs nothing, and never blocks legitimate
 * non-commercial speech: at most it asks the member to pick a promotion
 * package when the text carries strong selling signals. Borderline content is
 * always allowed to publish as regular content.
 *
 * The detector is deliberately transparent — every decision comes with the
 * list of phrases that triggered it, so the notice can explain itself.
 */

export type PromotionLevel = "none" | "possible" | "strong";

export interface PromotionDetection {
  level: PromotionLevel;
  /** Weighted total. Kept for tests and for tuning; never shown raw to members. */
  score: number;
  /** Human-readable reasons, e.g. "mentions a price" — safe to render. */
  signals: string[];
}

/** Explicit selling language. Two of these, or one plus a price, is decisive. */
const SELLING_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfor sale\b/i, label: '"for sale"' },
  { pattern: /\b(on|now) sale\b/i, label: '"on sale"' },
  { pattern: /\bbuy (now|here|one|1)\b/i, label: '"buy now"' },
  { pattern: /\border (now|here|yours)\b/i, label: '"order now"' },
  { pattern: /\b(dm|pm|message|text|contact)\s+(me|us|to|for)\s+(order|orders|price|prices|details|booking|inquiries)\b/i, label: "asks people to message to order" },
  { pattern: /\bbook (now|your|a slot)\b/i, label: '"book now"' },
  { pattern: /\bpre[- ]?order\b/i, label: '"pre-order"' },
  { pattern: /\blimited (slots?|stocks?|offer|time)\b/i, label: "urgency wording" },
  { pattern: /\b\d{1,3}\s?% ?off\b/i, label: "a percentage discount" },
  { pattern: /\bpromo (code|price)\b/i, label: "a promo price or code" },
  { pattern: /\bfree (delivery|shipping)\b/i, label: '"free delivery"' },
  { pattern: /\b(cash on delivery|cod available)\b/i, label: '"cash on delivery"' },
  { pattern: /\b(installment|inquire now|avail now)\b/i, label: "sales wording" },
  { pattern: /\bi(?:'m| am)? ?selling\b|\bwe(?:'re| are)? ?selling\b|\bselling my\b/i, label: '"selling"' },
  { pattern: /\bvouchers? (for sale|available|on sale)\b/i, label: "a voucher offer" },
  { pattern: /\b(reseller|resellers) welcome\b/i, label: '"resellers welcome"' },
];

/** A concrete price. Strong on its own only when paired with selling language. */
const PRICE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(₱|php|piso|pesos?)\s?\d/i, label: "mentions a price" },
  { pattern: /\d+\s?(₱|php|pesos?)\b/i, label: "mentions a price" },
  { pattern: /\bp\d{2,}\b/i, label: "mentions a price" },
  { pattern: /\b\d+\s?(per|\/)\s?(pc|piece|pack|hour|hr|day|month)\b/i, label: "quotes a unit price" },
];

/** Commercial vocabulary. Weak on its own — many normal posts mention these. */
const COMMERCIAL_WORDS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdiscount(ed)?\b/i, label: 'mentions a discount' },
  { pattern: /\bpromo\b/i, label: 'mentions a promo' },
  { pattern: /\bavailable\b/i, label: '"available"' },
  { pattern: /\bin stock\b|\bstocks?\b/i, label: "mentions stock" },
  { pattern: /\bprice(s|list)?\b/i, label: "mentions price" },
  { pattern: /\b(package|packages|bundle)\b/i, label: "mentions packages" },
  { pattern: /\bbooking\b/i, label: "mentions booking" },
  { pattern: /\bdelivery\b/i, label: "mentions delivery" },
  { pattern: /\bshop (now|here)\b|\bmy shop\b|\bour shop\b/i, label: "points at a shop" },
];

/** Personal / conversational context. Pulls the score back down. */
const PERSONAL_MARKERS: RegExp[] = [
  /\bi (just )?(bought|got|tried|ate|used|visited)\b/i,
  /\bthank you\b|\bthanks\b|\bsalamat\b/i,
  /\bcongrat(s|ulations)\b/i,
  /\bhappy (birthday|anniversary|new year)\b/i,
  /\bi recommend\b|\bhighly recommend\b|\bmy honest (review|opinion)\b/i,
  /\bmy experience\b|\bjust sharing\b|\bgood morning\b|\bgood vibes\b/i,
];

const STRONG_THRESHOLD = 3;
const POSSIBLE_THRESHOLD = 1.5;

const uniq = (values: string[]): string[] => Array.from(new Set(values));

/**
 * Scores a post body for commercial intent. `hasImage` is accepted as context
 * but never adds weight on its own — a photo is not an advertisement.
 */
export function detectPromotion(
  body: string,
  context: { hasImage?: boolean } = {},
): PromotionDetection {
  const text = body.trim();
  if (!text) return { level: "none", score: 0, signals: [] };

  const signals: string[] = [];
  let score = 0;

  let sellingHits = 0;
  for (const { pattern, label } of SELLING_PHRASES) {
    if (pattern.test(text)) {
      sellingHits += 1;
      score += 2;
      signals.push(label);
    }
  }

  let priceHit = false;
  for (const { pattern, label } of PRICE_PATTERNS) {
    if (!priceHit && pattern.test(text)) {
      priceHit = true;
      score += 1.5;
      signals.push(label);
    }
  }

  let weak = 0;
  for (const { pattern, label } of COMMERCIAL_WORDS) {
    if (weak < 3 && pattern.test(text)) {
      weak += 1;
      score += 0.5;
      signals.push(label);
    }
  }

  // A photo only matters alongside real selling language, and even then it is
  // context rather than evidence, so it carries no weight of its own.
  if (context.hasImage && sellingHits > 0 && priceHit) signals.push("a photo with a priced offer");

  let personal = 0;
  for (const pattern of PERSONAL_MARKERS) {
    if (personal < 2 && pattern.test(text)) {
      personal += 1;
      score -= 1.5;
    }
  }

  score = Math.max(0, Number(score.toFixed(2)));

  const level: PromotionLevel =
    score >= STRONG_THRESHOLD ? "strong" : score >= POSSIBLE_THRESHOLD ? "possible" : "none";

  return { level, score, signals: uniq(signals) };
}

export const PROMOTION_NOTICE =
  "This post appears to promote a product or service. Promotional posts require a promotion package.";

/** One sentence explaining the detection, e.g. 'We saw "for sale" and a price.' */
export function detectionExplanation(detection: PromotionDetection): string {
  if (detection.signals.length === 0) return "No commercial signals found.";
  const list = detection.signals.slice(0, 3).join(", ");
  return `We noticed ${list}.`;
}

/**
 * Whether the member may publish without choosing a promotion package.
 *
 * Strong commercial signals require a package (when packages are actually
 * available). Borderline content only needs a one-tap acknowledgement, and
 * clean content needs nothing at all.
 */
export function promotionGate(input: {
  detection: PromotionDetection;
  promote: boolean;
  acknowledgedRegular: boolean;
  packagesAvailable: boolean;
}): string | null {
  if (input.promote) return null;
  if (!input.packagesAvailable) return null;
  if (input.detection.level === "strong")
    return "Choose a promotion package to publish this post.";
  if (input.detection.level === "possible" && !input.acknowledgedRegular)
    return "Confirm this is regular content, or choose a promotion package.";
  return null;
}

/** True when the member is allowed to override and post as regular content. */
export function canPostAsRegular(detection: PromotionDetection): boolean {
  return detection.level !== "strong";
}
