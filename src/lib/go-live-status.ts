/**
 * Human-readable Go Live / subscription payment states for the platform owner.
 *
 * PURE PRESENTATION. This module invents no matching rule and reads no new
 * data: it only translates the reconciliation state the existing engine already
 * writes onto `subscription_requests` (`status`, `auto_state`, `auto_reason`,
 * `receipt_check`, `listener_event_id`, `proof_path`, `payer_number_key`) into
 * a sentence a person can act on. The GCash listener, its tolerance, timing
 * window and duplicate-reference rules are untouched.
 */

export type GoLiveStatusKind =
  | "activated" // listener verified and the shop is live — nothing to do
  | "approved_manually" // a platform owner approved it as an exception
  | "waiting" // listener has not seen the payment yet — no action required
  | "review" // genuinely needs a human decision
  | "invalid" // the request itself is missing something
  | "rejected";

export interface GoLiveStatus {
  kind: GoLiveStatusKind;
  /** Short badge text. */
  badge: string;
  tone: "positive" | "warning" | "negative" | "muted" | "brand";
  /** One sentence explaining WHY it is in this state. */
  detail: string;
  /** True when the platform owner must actually do something. */
  actionRequired: boolean;
  /** Where the problem gets corrected, when a person can correct it. */
  fix?: string;
  /** Extra evidence note (receipt reading), never an approval authority. */
  note?: string;
}

export interface GoLiveRequestLike {
  status: string;
  auto_state?: string | null;
  auto_reason?: string | null;
  receipt_check?: string | null;
  listener_event_id?: string | null;
  proof_path?: string | null;
  payer_number_key?: string | null;
  payment_reference?: string | null;
  decision_reason?: string | null;
}

const receiptNote = (check: string | null | undefined): string | undefined => {
  switch (check) {
    case "matched":
      return "Receipt reference matches the reference the operator typed.";
    case "mismatch":
      return "The reference read from the screenshot is not the reference on the request.";
    case "unreadable":
      return "The payment screenshot could not be read automatically.";
    default:
      return undefined;
  }
};

export function describeGoLiveRequest(r: GoLiveRequestLike): GoLiveStatus {
  const note = receiptNote(r.receipt_check);

  if (r.status === "approved") {
    return r.listener_event_id
      ? {
          kind: "activated",
          badge: "Activated automatically",
          tone: "positive",
          detail:
            "The platform GCash listener verified this payment and the shop was switched to live. No Super Admin action is required.",
          actionRequired: false,
          note,
        }
      : {
          kind: "approved_manually",
          badge: "Approved manually",
          tone: "positive",
          detail:
            "This payment was approved by the platform owner as an exception, not by the GCash listener.",
          actionRequired: false,
          note,
        };
  }

  if (r.status === "rejected") {
    return {
      kind: "rejected",
      badge: "Rejected",
      tone: "negative",
      detail: r.decision_reason?.trim() || "This payment was rejected by the platform owner.",
      actionRequired: false,
      note,
    };
  }

  // ---- still pending -------------------------------------------------
  if (!r.proof_path?.trim()) {
    return {
      kind: "invalid",
      badge: "Missing proof of payment",
      tone: "negative",
      detail:
        "No GCash payment screenshot is attached to this request, so there is no evidence to check it against.",
      actionRequired: true,
      fix: "Ask the shop operator to resubmit the Go Live payment from Admin → Go Live with the GCash screenshot attached.",
      note,
    };
  }

  if (!r.payer_number_key?.trim()) {
    return {
      kind: "invalid",
      badge: "Incomplete request",
      tone: "negative",
      detail:
        "No sending GCash number was recorded, so this payment can never be matched to a GCash notification.",
      actionRequired: true,
      fix: "Ask the shop operator to resubmit from Admin → Go Live and enter the GCash number the payment was sent from.",
      note,
    };
  }

  if (r.auto_state === "ambiguous") {
    return {
      kind: "review",
      badge: "Manual review required",
      tone: "warning",
      detail:
        r.auto_reason?.trim() ||
        "More than one GCash notification matches this payment, so the engine will not pick one automatically.",
      actionRequired: true,
      fix: "Compare the notifications in Approvals → Unmatched payments, then approve or reject this request here.",
      note,
    };
  }

  const reason = (r.auto_reason ?? "").toLowerCase();

  if (reason.includes("already used")) {
    return {
      kind: "review",
      badge: "Payment already used",
      tone: "warning",
      detail:
        "The matching GCash notification had already been applied to another payment, so it cannot be used again.",
      actionRequired: true,
      fix: "Confirm with the operator which payment this reference belongs to before approving or rejecting.",
      note,
    };
  }

  if (r.receipt_check === "mismatch") {
    return {
      kind: "review",
      badge: "Manual review required",
      tone: "warning",
      detail:
        "The reference read from the uploaded receipt does not match the reference on this request. Matching is still waiting on the listener; this evidence mismatch needs a human look.",
      actionRequired: true,
      fix: "Open the screenshot below and compare it with the reference on the request.",
      note,
    };
  }

  if (r.auto_state === "verified") {
    return {
      kind: "waiting",
      badge: "Verified — finishing activation",
      tone: "brand",
      detail:
        "The GCash listener already confirmed this payment; the shop is being switched to live. No Super Admin action is required.",
      actionRequired: false,
      note,
    };
  }

  return {
    kind: "waiting",
    badge: "Waiting for GCash Listener",
    tone: "muted",
    detail:
      r.auto_reason?.trim() ||
      "No matching GCash notification has arrived yet for this amount and sending number. The shop activates by itself the moment it does.",
    actionRequired: false,
    note,
  };
}

/** Sorting helper: things needing a decision first, then waiting, then done. */
export const goLiveStatusWeight = (s: GoLiveStatus): number =>
  s.kind === "invalid" ? 0 : s.kind === "review" ? 1 : s.actionRequired ? 2 : 3;
