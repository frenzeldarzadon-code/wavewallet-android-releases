/**
 * GO LIVE readiness — what an operator must complete before a New Generation
 * (Demo) shop can be paid for and switched to live.
 *
 * Pure data only. This module invents NO new requirements: every item below is
 * something the existing `submit_go_live_payment` RPC already refuses without,
 * expressed up-front so the operator is told before submitting instead of
 * receiving a bare backend error afterwards. Nothing here touches the GCash
 * listener, its calibration, matching or duplicate-reference rules — those stay
 * exactly as they are; this only explains them earlier.
 */

export type GoLiveField = "plan" | "months" | "payerNumber" | "reference" | "proof";

export interface GoLiveItem {
  id: string;
  /** Short label for the "Complete these items" checklist. */
  label: string;
  /** What the operator has to do about it, in plain words. */
  how: string;
  /** Element id to focus/scroll to, when the item is a field on this page. */
  fieldId?: string;
  /** Route to send the operator to, when the item lives elsewhere. */
  to?: string;
  /** True when the operator cannot fix it themselves (platform-side). */
  blocking?: boolean;
}

export interface GoLiveReadinessInput {
  shopName: string | null | undefined;
  /** Only New Generation (subscription) shops use this flow. */
  shopKind: string | null | undefined;
  planId: string;
  months: number;
  payerNumber: string;
  reference: string;
  /** Platform GCash number the subscription payment must be sent to. */
  platformGcashNumber: string | null | undefined;
  /** A payment for this shop is already awaiting verification. */
  hasPendingRequest: boolean;
  /** Uploaded payment screenshot path — required, exactly like Cash In. */
  proofPath?: string | null;
}

/** 09XXXXXXXXX / +639XXXXXXXXX / 639XXXXXXXXX → 639XXXXXXXXX. */
export function normalizeSenderNumber(input: string): string | null {
  const digits = (input || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return digits;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  return null;
}

/** Per-field messages, shown in red under the field itself. */
export function goLiveFieldErrors(
  input: Pick<GoLiveReadinessInput, "planId" | "months" | "payerNumber" | "reference" | "proofPath">,
): Partial<Record<GoLiveField, string>> {
  const errors: Partial<Record<GoLiveField, string>> = {};
  if (!input.planId) errors.plan = "Choose the plan you are paying for.";
  if (!Number.isFinite(input.months) || input.months < 1 || input.months > 24)
    errors.months = "Enter how many months you paid for, between 1 and 24.";
  if (!input.payerNumber.trim())
    errors.payerNumber = "Enter the GCash number you sent the payment from.";
  else if (!normalizeSenderNumber(input.payerNumber))
    errors.payerNumber = "That is not a valid GCash mobile number. Use the 09XXXXXXXXX format.";
  const ref = (input.reference || "").replace(/\s/g, "");
  if (!ref) errors.reference = "Enter the reference number printed on your GCash receipt.";
  else if (ref.length < 6)
    errors.reference = "A GCash reference number is longer than that — copy it exactly from the receipt.";
  if (!input.proofPath?.trim())
    errors.proof =
      "Attach the GCash payment screenshot. It is the same proof of payment the Cash In process requires.";
  return errors;
}

/** Everything still missing, in the order the operator should fix it. */
export function goLiveChecklist(input: GoLiveReadinessInput): GoLiveItem[] {
  const items: GoLiveItem[] = [];

  if (!input.shopName?.trim()) {
    items.push({
      id: "shop-name",
      label: "Your shop needs a name",
      how: "Open Shop settings and give the shop the name your customers will see.",
      to: "/admin/settings",
    });
  }

  if (input.shopKind !== "subscription") {
    items.push({
      id: "shop-kind",
      label: "This shop does not use the subscription flow",
      how: "Only New Generation shops go live from here. Contact WaveWallet support.",
      blocking: true,
    });
  }

  if (!input.platformGcashNumber?.trim()) {
    items.push({
      id: "platform-gcash",
      label: "WaveWallet has not published a GCash number yet",
      how: "You cannot pay until the platform owner configures it. Please contact WaveWallet support.",
      blocking: true,
    });
  }

  if (input.hasPendingRequest) {
    items.push({
      id: "pending",
      label: "A payment for this shop is already awaiting verification",
      how: "Wait for the current payment to be recognised before submitting another one.",
      blocking: true,
    });
  }

  const fields = goLiveFieldErrors(input);
  if (fields.plan)
    items.push({ id: "plan", label: "Plan not selected", how: fields.plan, fieldId: "gl-plans" });
  if (fields.months)
    items.push({ id: "months", label: "Number of months", how: fields.months, fieldId: "gl-months" });
  if (fields.payerNumber)
    items.push({
      id: "payerNumber",
      label: "GCash number you paid from",
      how: fields.payerNumber,
      fieldId: "gl-number",
    });
  if (fields.reference)
    items.push({
      id: "reference",
      label: "GCash reference number",
      how: fields.reference,
      fieldId: "gl-ref",
    });
  if (fields.proof)
    items.push({
      id: "proof",
      label: "Payment screenshot",
      how: fields.proof,
      fieldId: "gl-proof",
    });

  return items;
}

/**
 * Turns a backend refusal into a readable, field-attached message so the
 * operator never sees a bare error string with no next step.
 */
export function mapGoLiveError(message: string): { field?: GoLiveField; message: string } {
  const m = (message || "").toLowerCase();
  if (m.includes("reference was already used") || m.includes("only be used once"))
    return {
      field: "reference",
      message:
        "That GCash reference has already been used for another payment. Check your receipt and enter the reference of the payment you just made — each reference can only ever be used once.",
    };
  if (m.includes("payment screenshot is required"))
    return {
      field: "proof",
      message:
        "Attach the GCash payment screenshot before submitting — the payment cannot be reviewed without it.",
    };
  if (m.includes("proof of payment must belong to you"))
    return {
      field: "proof",
      message: "That screenshot could not be attached to your account. Upload it again from this device.",
    };
  if (m.includes("reference number is required"))
    return { field: "reference", message: "Enter the reference number printed on your GCash receipt." };
  if (m.includes("09xxxxxxxxx") || m.includes("paying from"))
    return {
      field: "payerNumber",
      message: "Enter the GCash number you sent the payment from, in the 09XXXXXXXXX format.",
    };
  if (m.includes("months must be"))
    return { field: "months", message: "Enter how many months you paid for, between 1 and 24." };
  if (m.includes("available plan"))
    return { field: "plan", message: "That plan is no longer available — pick another plan." };
  if (m.includes("already awaiting verification"))
    return {
      message:
        "A payment for this shop is already awaiting verification. Wait for it to be recognised before submitting another one.",
    };
  if (m.includes("only this shop admin"))
    return {
      message:
        "Only the admin of this shop can pay for its subscription. Sign in with the shop admin account and try again.",
    };
  return {
    message: message || "That payment could not be submitted. Check the details and try again.",
  };
}
