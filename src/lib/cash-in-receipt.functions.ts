/**
 * Server entry point for the Cash In receipt reference check.
 *
 * The caller must be signed in and may only ask for their OWN pending request
 * (the platform owner and the shop's admin may re-run it during review). The
 * outcome is written by `apply_cash_in_receipt_ocr`, which is the only place
 * that may unblock automatic approval.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decideReceiptCheck, type ReceiptCheck } from "./cash-in-receipt";

export interface ReceiptCheckResult {
  check: ReceiptCheck;
  /** The reference read off the receipt, when it could be read at all. */
  receiptReference: string | null;
  status: string;
  approvalMethod: string | null;
}

export const verifyCashInReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cashInId: string }) => {
    const cashInId = (input?.cashInId ?? "").trim();
    if (!cashInId) throw new Error("A cash in id is required.");
    return { cashInId };
  })
  .handler(async ({ data, context }): Promise<ReceiptCheckResult> => {
    // RLS: only the member who submitted this cash in, their shop's admin or
    // the platform owner can read the row at all.
    const { data: row, error } = await context.supabase
      .from("cash_in_requests")
      .select("id, status, proof_path, payer_reference, approval_method")
      .eq("id", data.cashInId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That cash in request could not be found.");
    if (row.status !== "pending") {
      return {
        check: "skipped",
        receiptReference: null,
        status: row.status as string,
        approvalMethod: (row.approval_method as string | null) ?? null,
      };
    }
    if (!row.proof_path) throw new Error("That cash in has no payment screenshot to read.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readReceipt } = await import("./cash-in-receipt.server");

    const signed = await supabaseAdmin.storage
      .from("cash-in-proofs")
      .createSignedUrl(row.proof_path as string, 300);
    if (!signed.data?.signedUrl) throw new Error("The payment screenshot could not be opened.");

    let reading;
    let check: ReceiptCheck;
    try {
      reading = await readReceipt(signed.data.signedUrl);
      check = decideReceiptCheck(row.payer_reference as string | null, reading);
    } catch {
      reading = { reference: null, amountPhp: null, senderNumber: null, confidence: 0, readable: false };
      check = "error";
    }

    await supabaseAdmin.rpc("apply_cash_in_receipt_ocr", {
      _id: data.cashInId,
      _reference: reading.reference,
      _amount: reading.amountPhp,
      _sender: reading.senderNumber,
      _readable: check !== "error" && reading.readable,
      _details: { confidence: reading.confidence, check, read_at: new Date().toISOString() },
    } as never);

    const { data: after } = await supabaseAdmin
      .from("cash_in_requests")
      .select("status, approval_method, receipt_check")
      .eq("id", data.cashInId)
      .maybeSingle();

    return {
      check: ((after?.receipt_check as ReceiptCheck | undefined) ?? check) as ReceiptCheck,
      receiptReference: reading.reference,
      status: (after?.status as string) ?? "pending",
      approvalMethod: (after?.approval_method as string | null) ?? null,
    };
  });
