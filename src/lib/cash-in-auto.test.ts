import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_RULE,
  evaluateMatch,
  matchingStatusLabel,
  MATCH_REASON,
  normalizePaymentReference,
  normalizePhMobile,
  samePhMobile,
  type AutoApprovalRule,
  type CashInAutoStatus,
  type MatchableRequest,
} from "./cash-in-auto";
import { eventResultLabel } from "./listener-devices";

const on: AutoApprovalRule = { ...DEFAULT_AUTO_RULE, enabled: true, require_listener_match: true };
const RECEIVING = "09541230072";
const SENDER = "09171234567";

/** A real GCash notification seen by the paired phone on the receiving account. */
const seen = { sender_number: "+639171234567", amount_php: 500, outcome: "accepted", device_online: true };

const req: MatchableRequest = {
  amount_php: 500,
  payer_reference: "GC-1234",
  sender_number: SENDER,
  proof_path: "user/abc.jpg",
  receipt_check: "matched",
  status: "pending",
  listener_event: seen,
};

describe("payment reference normalisation", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizePaymentReference("GC-1234")).toBe(normalizePaymentReference("gc 1234"));
    expect(normalizePaymentReference("  gc/1234 ")).toBe("gc1234");
  });
  it("treats blank references as absent", () => {
    expect(normalizePaymentReference("")).toBeNull();
    expect(normalizePaymentReference("---")).toBeNull();
    expect(normalizePaymentReference(null)).toBeNull();
  });
});

describe("Philippine mobile normalisation", () => {
  it("treats equivalent formats as the same number", () => {
    expect(normalizePhMobile("09171234567")).toBe("639171234567");
    expect(normalizePhMobile("+63 917 123 4567")).toBe("639171234567");
    expect(normalizePhMobile("639171234567")).toBe("639171234567");
    expect(normalizePhMobile("9171234567")).toBe("639171234567");
    expect(samePhMobile("09171234567", "+639171234567")).toBe(true);
  });
  it("keeps different numbers apart", () => {
    expect(samePhMobile("09171234567", "09181234567")).toBe(false);
    expect(samePhMobile(null, "09171234567")).toBe(false);
    expect(normalizePhMobile("")).toBeNull();
  });
});

describe("automatic approval matching", () => {
  it("approves when a real payment matches the sender and the exact amount", () => {
    expect(evaluateMatch(req, on, RECEIVING)).toBe("matched");
  });

  it("approves a payment that arrived before the request was submitted", () => {
    // Order is irrelevant here: the request simply carries the linked event.
    expect(evaluateMatch({ ...req, listener_event: { ...seen } }, on, RECEIVING)).toBe("matched");
  });

  it("compares equivalent phone formats", () => {
    expect(
      evaluateMatch({ ...req, sender_number: "+639171234567" }, on, "+63 954 123 0072"),
    ).toBe("matched");
  });

  it("never approves while the feature is off", () => {
    expect(evaluateMatch(req, DEFAULT_AUTO_RULE, RECEIVING)).toBe("disabled");
  });

  it("never approves a duplicate reference", () => {
    expect(evaluateMatch({ ...req, duplicate_reference: true }, on, RECEIVING)).toBe("duplicate_reference");
  });

  it("uses the receipt reference when the member typed none", () => {
    // Screenshot-first submissions carry no typed reference at all.
    expect(
      evaluateMatch({ ...req, payer_reference: "", receipt_reference: "9044011942642" }, on, RECEIVING),
    ).toBe("matched");
  });

  it("waits for the receipt reading when there is no reference anywhere", () => {
    expect(evaluateMatch({ ...req, payer_reference: "", receipt_reference: null }, on, RECEIVING)).toBe(
      "awaiting_receipt_check",
    );
  });

  it("holds an unreadable screenshot that produced no reference", () => {
    expect(
      evaluateMatch(
        { ...req, payer_reference: "", receipt_reference: null, receipt_check: "unreadable" },
        on,
        RECEIVING,
      ),
    ).toBe("receipt_unreadable");
  });

  it("passes the first layer without a listener reference", () => {
    const event = { ...seen, reference: null };
    expect(evaluateMatch({ ...req, listener_event: event }, on, RECEIVING)).toBe("matched");
  });

  it("ignores a reference on the notification: the receipt owns the reference", () => {
    const event = { ...seen, reference: "1111111111111" };
    expect(evaluateMatch({ ...req, listener_event: event }, on, RECEIVING)).toBe("matched");
  });

  it("holds when the receipt was paid into a different GCash account", () => {
    expect(evaluateMatch({ ...req, receipt_receiving_number: "09990001111" }, on, RECEIVING)).toBe(
      "receiving_mismatch",
    );
  });

  it("accepts a receipt whose receiving account is this shop's account", () => {
    expect(evaluateMatch({ ...req, receipt_receiving_number: RECEIVING }, on, RECEIVING)).toBe("matched");
  });


  it("holds when the receipt amount contradicts the request", () => {
    expect(evaluateMatch({ ...req, receipt_amount_php: 999 }, on, RECEIVING)).toBe("amount_mismatch");
  });

  it("requires the payment screenshot as supporting evidence", () => {
    expect(evaluateMatch({ ...req, proof_path: null }, on, RECEIVING)).toBe("no_proof");
  });

  it("never approves on the screenshot alone, without a real notification", () => {
    expect(evaluateMatch({ ...req, listener_event: null }, on, RECEIVING)).toBe("awaiting_listener");
  });

  it("rejects a payment sent from a different GCash number", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, sender_number: "09181234567" } }, on, RECEIVING),
    ).toBe("number_mismatch");
  });

  it("rejects a payment whose amount differs from the request", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, amount_php: 499 } }, on, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("requires the sending number on the request", () => {
    expect(evaluateMatch({ ...req, sender_number: null }, on, RECEIVING)).toBe("no_sender_number");
  });

  it("cannot approve when no receiving number is configured", () => {
    expect(evaluateMatch(req, on, null)).toBe("no_receiving_number");
  });

  it("waits while the paired phone is offline", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, device_online: false } }, on, RECEIVING),
    ).toBe("listener_offline");
  });

  it("rejects a wrong amount against the configured expected amount", () => {
    const exact = { ...on, expected_amount_php: 500 };
    expect(evaluateMatch(req, exact, RECEIVING)).toBe("matched");
    expect(
      evaluateMatch({ ...req, amount_php: 499, listener_event: { ...seen, amount_php: 499 } }, exact, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("accepts a small difference only within the configured tolerance", () => {
    const lenient = { ...on, expected_amount_php: 500, amount_tolerance_php: 1 };
    expect(
      evaluateMatch({ ...req, amount_php: 499, listener_event: { ...seen, amount_php: 499 } }, lenient, RECEIVING),
    ).toBe("matched");
    expect(
      evaluateMatch({ ...req, amount_php: 497, listener_event: { ...seen, amount_php: 497 } }, lenient, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("leaves amounts above the automatic limit for manual review", () => {
    expect(evaluateMatch(req, { ...on, max_auto_amount_php: 400 }, RECEIVING)).toBe("above_auto_limit");
  });

  it("never re-decides a settled request", () => {
    expect(evaluateMatch({ ...req, status: "approved" }, on, RECEIVING)).toBe("not_pending");
  });

  it("has member-readable wording for every outcome", () => {
    for (const reason of Object.values(MATCH_REASON)) expect(reason.length).toBeGreaterThan(10);
    expect(MATCH_REASON.matched).not.toMatch(/GCash verified/i);
  });
});

describe("settings banner", () => {
  const base: CashInAutoStatus = {
    platform_rule: null,
    shop_rules: [],
    shops_with_number: 0,
    duplicates_blocked_30d: 0,
    auto_approved_30d: 0,
  };

  it("warns while automatic matching is off", () => {
    expect(matchingStatusLabel(base).tone).toBe("warning");
    expect(matchingStatusLabel(null).tone).toBe("warning");
  });

  it("confirms once matching is enabled, without claiming GCash verified anything", () => {
    const label = matchingStatusLabel({
      ...base,
      platform_rule: { ...DEFAULT_AUTO_RULE, enabled: true, ecosystem_id: null },
    });
    expect(label.tone).toBe("success");
    expect(label.detail).toMatch(/never contacted/i);
  });
});

describe("destination-aware and configurable verification layers", () => {
  const on = { ...DEFAULT_AUTO_RULE, enabled: true };
  const request: MatchableRequest = {
    amount_php: 500,
    payer_reference: "GC-1234",
    sender_number: "0917 555 1234",
    proof_path: "user/abc.jpg",
    receipt_check: "matched",
    status: "pending",
    listener_event: {
      sender_number: "09175551234",
      amount_php: 500,
      outcome: "accepted",
      device_online: true,
      serves_shop: true,
    },
  };
  const RECEIVING = "09541230072";

  it("approves when both layers pass and verification is active", () => {
    expect(evaluateMatch(request, { ...on, verification_mode: "active" }, RECEIVING)).toBe("matched");
  });

  it("never settles while staged, even when every check passes", () => {
    expect(evaluateMatch(request, { ...on, verification_mode: "staged" }, RECEIVING)).toBe("staged");
  });

  it("refuses a notification seen on another shop's receiving account", () => {
    const other = {
      ...request,
      listener_event: { ...request.listener_event!, serves_shop: false },
    };
    expect(evaluateMatch(other, { ...on, verification_mode: "active" }, RECEIVING)).toBe("wrong_shop");
  });

  it("can run without the listener layer but still blocks a wrong sender when one is linked", () => {
    const noEvent = { ...request, listener_event: null };
    expect(
      evaluateMatch(noEvent, { ...on, require_listener_match: false, verification_mode: "active" }, RECEIVING),
    ).toBe("matched");
    expect(evaluateMatch(noEvent, { ...on, require_listener_match: true }, RECEIVING)).toBe("awaiting_listener");
  });

  it("always blocks a receipt mismatch, even with the second layer relaxed", () => {
    const mismatch = { ...request, receipt_check: "mismatch" };
    expect(evaluateMatch(mismatch, { ...on, require_receipt_match: false }, RECEIVING)).toBe(
      "receipt_reference_mismatch",
    );
    const unreadable = { ...request, receipt_check: "unreadable" };
    expect(evaluateMatch(unreadable, { ...on, require_receipt_match: true }, RECEIVING)).toBe("receipt_unreadable");
    expect(
      evaluateMatch(unreadable, { ...on, require_receipt_match: false, verification_mode: "active" }, RECEIVING),
    ).toBe("matched");
  });
});

describe("a masked receiving number never blocks a valid Cash In", () => {
  it("reports a differing receiving number as informational, not a failure", () => {
    expect(eventResultLabel({ match_result: "destination_mismatch" } as never)).toMatch(
      /informational|does not block/i,
    );
    expect(eventResultLabel({ match_result: "wrong_shop" } as never)).toMatch(/different shop/i);
    expect(eventResultLabel({ match_result: "no_pending_match" } as never)).toMatch(
      /No pending Cash In matched/i,
    );
  });

  it("approves the live ₱100 case even when GCash masked the receiving number", () => {
    const rule = { ...on, verification_mode: "active" as const };
    const request = {
      amount_php: 100,
      payer_reference: "9044061112678",
      sender_number: "09070321959",
      proof_path: "p.jpg",
      receipt_check: "matched",
      listener_event: {
        amount_php: 100,
        sender_number: "09070321959",
        outcome: "accepted",
        device_online: true,
        serves_shop: true,
        receiving_number_matches: false,
      },
    };
    expect(evaluateMatch(request, rule, RECEIVING)).toBe("matched");
  });

  it("still blocks a phone paired to another shop, a wrong amount and a wrong sender", () => {
    const rule = { ...on, verification_mode: "active" as const };
    const base = {
      amount_php: 100,
      payer_reference: "9044061112678",
      sender_number: "09070321959",
      proof_path: "p.jpg",
      receipt_check: "matched",
      listener_event: {
        amount_php: 100,
        sender_number: "09070321959",
        outcome: "accepted",
        device_online: true,
        serves_shop: true,
      },
    };
    expect(
      evaluateMatch({ ...base, listener_event: { ...base.listener_event, serves_shop: false } }, rule, RECEIVING),
    ).toBe("wrong_shop");
    expect(
      evaluateMatch({ ...base, listener_event: { ...base.listener_event, amount_php: 250 } }, rule, RECEIVING),
    ).toBe("amount_mismatch");
    expect(
      evaluateMatch(
        { ...base, listener_event: { ...base.listener_event, sender_number: "09990000000" } },
        rule,
        RECEIVING,
      ),
    ).toBe("number_mismatch");
    expect(evaluateMatch({ ...base, duplicate_reference: true }, rule, RECEIVING)).toBe("duplicate_reference");
  });
});
