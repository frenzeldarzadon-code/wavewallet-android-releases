/**
 * Go Live receipt verification — reuses the EXISTING Cash In receipt reader.
 *
 * Exactly like Cash In, the copy that counts is the one read on the server
 * from the uploaded screenshot; nothing the browser sends can change it. The
 * outcome is stored as EVIDENCE on the subscription request. It never approves
 * a payment: the platform GCash listener remains the only authority for
 * automatic activation, and its rules are untouched here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decideReceiptCheck, type ReceiptCheck } from "./cash-in-receipt";

export interface GoLiveReceiptResult {
  check: ReceiptCheck;
  receiptReference: string | null;
  status: string;
  autoState: string | null;
}

export const verifyGoLiveReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => {
    const requestId = (input?.requestId ?? "").trim();
    if (!requestId) throw new Error("A subscription request id is required.");
    return { requestId };
  })
  .handler(async ({ data, context }): Promise<GoLiveReceiptResult> => {
    // RLS: only the shop's admin and the platform owner can read this row.
    const { data: row, error } = await context.supabase
      .from("subscription_requests")
      .select("id, status, proof_path, payment_reference, auto_state")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That subscription payment could not be found.");
    if (row.status !== "pending") {
      return {
        check: "skipped",
        receiptReference: null,
        status: row.status as string,
        autoState: (row.auto_state as string | null) ?? null,
      };
    }
    if (!row.proof_path) throw new Error("That payment has no screenshot to read.");

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
      check = decideReceiptCheck(row.payment_reference as string | null, reading);
    } catch {
      reading = {
        reference: null,
        amountPhp: null,
        senderNumber: null,
        receivingNumber: null,
        receivingName: null,
        transferMethod: null,
        statusText: null,
        feePhp: null,
        rawText: null,
        paidAt: null,
        confidence: 0,
        readable: false,
      };
      check = "error";
    }

    await supabaseAdmin.rpc("apply_go_live_receipt_ocr", {
      _id: data.requestId,
      _reference: reading.reference,
      _amount: reading.amountPhp,
      _sender: reading.senderNumber,
      _readable: check !== "error" && reading.readable,
      _paid_at: reading.paidAt ?? null,
      _details: {
        confidence: reading.confidence,
        check,
        read_at: new Date().toISOString(),
        receiving_number: reading.receivingNumber ?? null,
        receiving_account_masked: reading.receivingAccountMasked ?? null,
        receiving_name: reading.receivingName ?? null,
        provider_name: reading.providerName ?? null,
        sender_name: reading.senderName ?? null,
        sender_account_masked: reading.senderAccountMasked ?? null,
        transfer_method: reading.transferMethod ?? null,
        status_text: reading.statusText ?? null,
        fee_php: reading.feePhp ?? null,
        raw_text: reading.rawText ?? null,
      },
    } as never);

    const { data: after } = await supabaseAdmin
      .from("subscription_requests")
      .select("status, auto_state, receipt_check")
      .eq("id", data.requestId)
      .maybeSingle();

    return {
      check: ((after?.receipt_check as ReceiptCheck | undefined) ?? check) as ReceiptCheck,
      receiptReference: reading.reference,
      status: (after?.status as string) ?? "pending",
      autoState: (after?.auto_state as string | null) ?? null,
    };
  });
