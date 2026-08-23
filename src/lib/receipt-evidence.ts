/**
 * How much INDEPENDENT payment evidence a screenshot actually produced.
 *
 * This is a presentation-layer summary only: it never approves anything. The
 * database keeps the authority (the listener match, the >=2 signal rule, the
 * duplicate-reference guard). Its job is to tell the applicant, before they
 * submit, whether the screenshot carried at least two independent details that
 * the automatic check can work with — and exactly which one is missing when it
 * did not.
 *
 * Rule, mirroring the backend: the amount ALONE is never enough. At least one
 * identifying detail (reference, sending identity or receiving account) must
 * have been read as well.
 */

export interface ReceiptEvidenceInput {
  /** Reference / transaction number read off the screenshot. */
  reference: string | null;
  /** Any printed sending identity: number, masked account or payer name. */
  senderNumber: string | null;
  senderName?: string | null;
  senderAccountMasked?: string | null;
  /** Any printed receiving identity. */
  receivingNumber?: string | null;
  receivingName?: string | null;
  receivingAccountMasked?: string | null;
  amountPhp: number | null;
  readable: boolean;
}

export interface EvidenceSignal {
  id: "reference" | "sender" | "receiver" | "amount";
  label: string;
  value: string | null;
  detected: boolean;
}

export interface ReceiptEvidence {
  signals: EvidenceSignal[];
  /** Independent details actually read off the screenshot. */
  detected: EvidenceSignal[];
  /** True once there are >=2 details AND at least one is not the amount. */
  sufficient: boolean;
  /** Plain-language explanation of what is still missing. */
  message: string;
}

const first = (...values: (string | null | undefined)[]): string | null => {
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return null;
};

export function receiptEvidence(
  reading: ReceiptEvidenceInput | null | undefined,
  options: { expectedAmountPhp?: number | null } = {},
): ReceiptEvidence {
  const r = reading ?? null;
  const amountValue =
    r && r.amountPhp !== null && Number.isFinite(r.amountPhp) ? r.amountPhp : null;
  const expected = options.expectedAmountPhp ?? null;
  // An amount only counts as evidence when it agrees with what is due; a
  // different amount is information, not confirmation.
  const amountAgrees =
    amountValue !== null && (expected === null || Math.abs(amountValue - expected) < 0.01);

  const signals: EvidenceSignal[] = [
    {
      id: "reference",
      label: "Reference / transaction number",
      value: r?.reference ?? null,
      detected: Boolean(r?.reference),
    },
    {
      id: "sender",
      label: "Sending account or payer",
      value: first(r?.senderNumber, r?.senderAccountMasked, r?.senderName),
      detected: Boolean(first(r?.senderNumber, r?.senderAccountMasked, r?.senderName)),
    },
    {
      id: "receiver",
      label: "Receiving account",
      value: first(r?.receivingNumber, r?.receivingAccountMasked, r?.receivingName),
      detected: Boolean(first(r?.receivingNumber, r?.receivingAccountMasked, r?.receivingName)),
    },
    {
      id: "amount",
      label: "Amount paid",
      value: amountValue === null ? null : `₱${amountValue.toLocaleString()}`,
      detected: amountAgrees,
    },
  ];

  const detected = signals.filter((s) => s.detected);
  const identifying = detected.filter((s) => s.id !== "amount");
  const sufficient = detected.length >= 2 && identifying.length >= 1;

  let message: string;
  if (sufficient) {
    message = `Read ${detected.length} independent details from this screenshot — enough for the automatic payment check.`;
  } else if (detected.length === 0) {
    message =
      "Nothing could be read from this screenshot. Upload a clearer, uncropped screenshot of the whole payment result, or fill the details in yourself — it will then be reviewed by a person.";
  } else if (identifying.length === 0) {
    message =
      "Only the amount could be read. The amount on its own can never confirm a payment: the screenshot must also show the reference number, the account you paid from, or the account you paid to.";
  } else {
    const missing = signals
      .filter((s) => !s.detected && s.id !== "amount")
      .map((s) => s.label.toLowerCase());
    message = `Only one detail could be read. Automatic checking needs two — make sure the screenshot also shows the ${missing.join(" or the ")}.`;
  }

  return { signals, detected, sufficient, message };
}
