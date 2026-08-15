import { describe, expect, it } from "vitest";
import {
  creditedFirstLabel,
  decideReceiptCheck,
  parseReceiptReading,
  receiptSenderAgrees,
  type ReceiptReading,
} from "./cash-in-receipt";
import { evaluateMatch, type AutoRules, type MatchRequest, type ListenerEvent } from "./cash-in-auto";

const reading = (over: Partial<ReceiptReading> = {}): ReceiptReading => ({
  reference: "9044011942642",
  amountPhp: 200,
  senderNumber: "09541230072",
  confidence: 0.95,
  readable: true,
  ...over,
});

describe("receipt reference check", () => {
  it("matches when the receipt agrees with what the member typed", () => {
    expect(decideReceiptCheck("9044 011 942642", reading())).toBe("matched");
  });

  it("flags a mismatch when the typed reference differs from the receipt", () => {
    expect(decideReceiptCheck("1234567890123", reading())).toBe("mismatch");
  });

  it("never guesses when the receipt cannot be read", () => {
    expect(decideReceiptCheck("9044011942642", reading({ readable: false, reference: null }))).toBe("unreadable");
    expect(decideReceiptCheck("9044011942642", reading({ confidence: 0.2 }))).toBe("unreadable");
  });

  it("treats a missing typed reference as a mismatch, not a pass", () => {
    expect(decideReceiptCheck("", reading())).toBe("mismatch");
  });

  it("compares the sender number on the receipt with the submitted one", () => {
    expect(receiptSenderAgrees("+63 954 123 0072", "09541230072")).toBe(true);
    expect(receiptSenderAgrees("09171234567", "09541230072")).toBe(false);
    expect(receiptSenderAgrees("09171234567", null)).toBeNull();
  });
});

describe("parsing what the reader returned", () => {
  it("reads a plain JSON answer", () => {
    const parsed = parseReceiptReading(
      '{"reference":"9044011942642","amount_php":200,"sender_number":"09541230072","readable":true,"confidence":0.9}',
    );
    expect(parsed.reference).toBe("9044011942642");
    expect(parsed.amountPhp).toBe(200);
  });

  it("reads an answer wrapped in a code fence and prose", () => {
    const parsed = parseReceiptReading('Here you go:\n```json\n{"reference":"123","readable":true}\n```');
    expect(parsed.reference).toBe("123");
    expect(parsed.readable).toBe(true);
  });

  it("returns an unreadable result for junk", () => {
    expect(parseReceiptReading("I cannot read this image").readable).toBe(false);
    expect(parseReceiptReading('{"reference": null, "readable": false}').reference).toBeNull();
  });
});

/* The primary payment match is unchanged; these guard the added gate. */
const rules: AutoRules = {
  enabled: true,
  require_reference_match: true,
  require_listener_match: true,
  amount_tolerance: 0,
  automatic_limit: 200,
  expected_amount: null,
};

const request = (over: Partial<MatchRequest> = {}): MatchRequest => ({
  amount_php: 200,
  payer_reference: "9044011942642",
  sender_number: "09541230072",
  receiving_number: "09541230072",
  duplicate_reference: false,
  receipt_check: "matched",
  ...over,
});

const event = (over: Partial<ListenerEvent> = {}): ListenerEvent => ({
  amount_php: 200,
  sender_number: "09541230072",
  receiving_number: "09541230072",
  reference: "9044011942642",
  device_online: true,
  ...over,
});

describe("automatic approval gate", () => {
  it("approves only once the receipt check has matched", () => {
    expect(evaluateMatch(request(), event(), rules)).toBe("matched");
  });

  it("holds a receipt mismatch for manual review", () => {
    expect(evaluateMatch(request({ receipt_check: "mismatch" }), event(), rules)).toBe("receipt_reference_mismatch");
  });

  it("holds an unreadable receipt for manual review", () => {
    expect(evaluateMatch(request({ receipt_check: "unreadable" }), event(), rules)).toBe("receipt_unreadable");
  });

  it("waits while the receipt has not been read yet", () => {
    expect(evaluateMatch(request({ receipt_check: "pending" }), event(), rules)).toBe("awaiting_receipt_check");
  });

  it("holds a reused reference regardless of a clean receipt", () => {
    expect(evaluateMatch(request({ duplicate_reference: true }), event(), rules)).toBe("duplicate_reference");
  });

  it("still refuses a wrong sender even with a matched receipt", () => {
    expect(evaluateMatch(request(), event({ sender_number: "09171234567" }), rules)).toBe("number_mismatch");
  });
});

describe("duplicate reference comparison", () => {
  it("says plainly which transaction was credited first", () => {
    expect(creditedFirstLabel({ credited_first: "old", credited_at: null })).toContain("earlier transaction");
    expect(creditedFirstLabel({ credited_first: "none", credited_at: null })).toContain("Neither");
  });
});
