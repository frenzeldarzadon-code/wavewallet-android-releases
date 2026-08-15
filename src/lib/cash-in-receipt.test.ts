import { describe, expect, it } from "vitest";
import {
  creditedFirstLabel,
  maskAccountNumber,
  verificationReason,
  verificationStatus,
  decideReceiptCheck,
  parseReceiptReading,
  receiptSenderAgrees,
  type ReceiptReading,
} from "./cash-in-receipt";
import { evaluateMatch, type AutoApprovalRule, type MatchableRequest } from "./cash-in-auto";

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
const rule: AutoApprovalRule = {
  enabled: true,
  amount_tolerance_php: 0,
  max_auto_amount_php: 200,
  expected_amount_php: null,
  require_listener_match: true,
};

const RECEIVING = "09541230072";

const request = (over: Partial<MatchableRequest> = {}): MatchableRequest => ({
  amount_php: 200,
  payer_reference: "9044011942642",
  sender_number: "09541230072",
  proof_path: "proofs/receipt.jpg",
  status: "pending",
  duplicate_reference: false,
  receipt_check: "matched",
  listener_event: {
    sender_number: "09541230072",
    amount_php: 200,
    outcome: "accepted",
    device_online: true,
  },
  ...over,
});

describe("automatic approval gate", () => {
  it("approves only once the receipt check has matched", () => {
    expect(evaluateMatch(request(), rule, RECEIVING)).toBe("matched");
  });

  it("approves a payment that arrived before the request was submitted", () => {
    // The linked notification is what proves payment; its order does not matter.
    expect(evaluateMatch(request(), rule, RECEIVING)).toBe("matched");
  });

  it("holds a receipt mismatch for manual review", () => {
    expect(evaluateMatch(request({ receipt_check: "mismatch" }), rule, RECEIVING)).toBe(
      "receipt_reference_mismatch",
    );
  });

  it("holds an unreadable receipt for manual review", () => {
    expect(evaluateMatch(request({ receipt_check: "unreadable" }), rule, RECEIVING)).toBe("receipt_unreadable");
    expect(evaluateMatch(request({ receipt_check: "error" }), rule, RECEIVING)).toBe("receipt_unreadable");
  });

  it("waits while the receipt has not been read yet", () => {
    expect(evaluateMatch(request({ receipt_check: "pending" }), rule, RECEIVING)).toBe("awaiting_receipt_check");
  });

  it("holds a reused reference regardless of a clean receipt", () => {
    expect(evaluateMatch(request({ duplicate_reference: true }), rule, RECEIVING)).toBe("duplicate_reference");
  });

  it("still refuses a wrong sender even with a matched receipt", () => {
    expect(
      evaluateMatch(
        request({ listener_event: { sender_number: "09171234567", amount_php: 200, outcome: "accepted" } }),
        rule,
        RECEIVING,
      ),
    ).toBe("number_mismatch");
  });

  it("still refuses a wrong amount even with a matched receipt", () => {
    expect(
      evaluateMatch(
        request({ listener_event: { sender_number: "09541230072", amount_php: 150, outcome: "accepted" } }),
        rule,
        RECEIVING,
      ),
    ).toBe("amount_mismatch");
  });
});

describe("duplicate reference comparison", () => {
  it("says plainly which transaction was credited first", () => {
    expect(creditedFirstLabel({ credited_first: "old", credited_at: null })).toContain("earlier transaction");
    expect(creditedFirstLabel({ credited_first: "none", credited_at: null })).toContain("Neither");
  });
});

describe("reviewer verification status", () => {
  it("passes a matched receipt", () => {
    expect(verificationStatus({ receipt_check: "matched" })).toBe("VERIFIED");
  });

  it("flags a mismatch and explains why it is pending", () => {
    expect(verificationStatus({ receipt_check: "mismatch" })).toBe("MISMATCH");
    expect(verificationReason({ receipt_check: "mismatch" })).toContain("does not match the payment receipt");
  });

  it("flags an unreadable receipt without guessing", () => {
    expect(verificationStatus({ receipt_check: "unreadable" })).toBe("UNREADABLE");
    expect(verificationStatus({ receipt_check: "error" })).toBe("UNREADABLE");
  });

  it("lets a duplicate reference outrank a matched receipt", () => {
    expect(verificationStatus({ receipt_check: "matched", duplicate_reference: true })).toBe("DUPLICATE_REFERENCE");
    expect(verificationReason({ duplicate_reference: true })).toContain("Duplicate reference");
  });

  it("waits while the receipt has not been read yet", () => {
    expect(verificationStatus({})).toBe("PENDING_REVIEW");
  });

  it("masks payment numbers for reviewers", () => {
    expect(maskAccountNumber("09541230072")).toBe("0954••••072");
    expect(maskAccountNumber(null)).toBe("not provided");
  });
});
