/**
 * Manual GCash payment recovery (platform owner only).
 *
 * Records a real GCash payment that a paired listener phone never captured.
 * The record is EVIDENCE ONLY: it credits no wallet, approves no Cash In and
 * touches no lineage, cashback or fee rule. It simply appears in the existing
 * "Incoming payments awaiting review" queue so the platform owner can attach it
 * to the right pending Cash In and then use the normal approval flow.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePhMobile } from "@/lib/cash-in-auto";

export interface ManualRecoveryInput {
  amountPhp: number;
  reference: string;
  /** Local datetime-local value or ISO string of when the money arrived. */
  receivedAt: string;
  receivingNumber: string;
  ecosystemId?: string | null;
  senderNumber?: string | null;
  senderName?: string | null;
  note?: string | null;
}

/** Pure client-side validation. The database re-checks every rule. */
export function validateManualRecovery(input: ManualRecoveryInput): string | null {
  if (!Number.isFinite(input.amountPhp) || input.amountPhp <= 0) {
    return "Enter the amount received, greater than zero.";
  }
  if ((input.reference ?? "").trim().length < 4) {
    return "Enter the GCash reference number from the notification or receipt.";
  }
  const when = new Date(input.receivedAt);
  if (Number.isNaN(when.getTime())) return "Enter the date and time the payment was received.";
  if (when.getTime() > Date.now() + 10 * 60 * 1000) {
    return "The received date and time cannot be in the future.";
  }
  if (!normalizePhMobile(input.receivingNumber)) {
    return "Enter the receiving GCash number that got the payment.";
  }
  const sender = (input.senderNumber ?? "").trim();
  if (sender !== "" && !normalizePhMobile(sender)) {
    return "The sender number is not a valid Philippine mobile number.";
  }
  return null;
}

export interface ManualRecoveryResult {
  recorded: boolean;
  event_id: string;
  gcash_reference: string;
  amount_php: number;
  review_state: string;
  credited: boolean;
}

export async function recordManualGcashPayment(
  input: ManualRecoveryInput,
): Promise<ManualRecoveryResult> {
  const problem = validateManualRecovery(input);
  if (problem) throw new Error(problem);

  const args: Record<string, unknown> = {
    _amount: input.amountPhp,
    _reference: input.reference.trim(),
    _received_at: new Date(input.receivedAt).toISOString(),
    _receiving_number: input.receivingNumber.trim(),
  };
  if (input.ecosystemId) args["_ecosystem"] = input.ecosystemId;
  if ((input.senderNumber ?? "").trim()) args["_sender_number"] = input.senderNumber!.trim();
  if ((input.senderName ?? "").trim()) args["_sender_name"] = input.senderName!.trim();
  if ((input.note ?? "").trim()) args["_note"] = input.note!.trim();

  const { data, error } = await (
    supabase.rpc as unknown as (
      name: string,
      params?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "record_manual_gcash_payment", args);
  if (error) throw new Error(error.message);
  return data as ManualRecoveryResult;
}
