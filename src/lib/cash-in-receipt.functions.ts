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

/** What the screenshot reader extracted, offered to the member for review. */
export interface ReceiptExtraction {
  reference: string | null;
  /** The app or bank the receipt came from, as printed on it. */
  providerName: string | null;
  amountPhp: number | null;
  senderNumber: string | null;
  /** Payer name printed on the receipt — common on bank transfers. */
  senderName: string | null;
  /** Masked sending account/card, when the receipt prints one instead of a number. */
  senderAccountMasked: string | null;
  /** Receiving account read off the receipt, when it was printed. */
  receivingNumber: string | null;
  receivingAccountMasked: string | null;
  paidAt: string | null;
  confidence: number;
  readable: boolean;
}

/**
 * Read an already-uploaded Cash In screenshot BEFORE the request exists, so
 * the form can be filled from the receipt instead of typed from memory.
 *
 * The reading is evidence only: the authoritative copy is read again on the
 * server after the request is created, so nothing the browser sends back can
 * change what the receipt actually says.
 */
export const extractCashInReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { proofPath: string }) => {
    const proofPath = (input?.proofPath ?? "").trim();
    if (!proofPath) throw new Error("Upload your payment screenshot first.");
    return { proofPath };
  })
  .handler(async ({ data, context }): Promise<ReceiptExtraction> => {
    // A member may only read a screenshot inside their own storage folder.
    const folder = data.proofPath.split("/")[0] ?? "";
    if (folder !== context.userId) {
      throw new Error("That payment screenshot does not belong to you.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readReceipt } = await import("./cash-in-receipt.server");
    const signed = await supabaseAdmin.storage
      .from("cash-in-proofs")
      .createSignedUrl(data.proofPath, 300);
    if (!signed.data?.signedUrl) throw new Error("The payment screenshot could not be opened.");
    const reading = await readReceipt(signed.data.signedUrl);
    return {
      reference: reading.reference,
      providerName: reading.providerName ?? null,
      amountPhp: reading.amountPhp,
      senderNumber: reading.senderNumber,
      senderName: reading.senderName ?? null,
      senderAccountMasked: reading.senderAccountMasked ?? null,
      receivingNumber: reading.receivingNumber ?? null,
      receivingAccountMasked: reading.receivingAccountMasked ?? null,
      paidAt: reading.paidAt ?? null,
      confidence: reading.confidence,
      readable: reading.readable,
    };
  });

/** SHA-256 of the uploaded screenshot bytes, or null when it cannot be read. */
async function hashProof(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
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
      reading = {
        reference: null,
        providerName: null,
        amountPhp: null,
        senderNumber: null,
        senderName: null,
        senderAccountMasked: null,
        receivingNumber: null,
        receivingAccountMasked: null,
        paidAt: null,
        confidence: 0,
        readable: false,
      };
      check = "error";
    }

    // Fingerprint the screenshot itself so the same image can never settle two
    // cash ins. Failing to hash it is never fatal — the request simply keeps
    // the protections it already had.
    const proofHash = await hashProof(signed.data.signedUrl);

    await supabaseAdmin.rpc("apply_cash_in_receipt_ocr", {
      _id: data.cashInId,
      _reference: reading.reference,
      _amount: reading.amountPhp,
      _sender: reading.senderNumber,
      _readable: check !== "error" && reading.readable,
      _paid_at: reading.paidAt ?? null,
      _receiving: reading.receivingNumber ?? null,
      _provider: reading.providerName ?? null,
      _sender_name: reading.senderName ?? null,
      _sender_account: reading.senderAccountMasked ?? null,
      _receiving_account: reading.receivingAccountMasked ?? null,
      _proof_hash: proofHash,
      _details: {
        confidence: reading.confidence,
        check,
        read_at: new Date().toISOString(),
        paid_at: reading.paidAt ?? null,
        provider_name: reading.providerName ?? null,
        sender_name: reading.senderName ?? null,
        sender_account_masked: reading.senderAccountMasked ?? null,
        receiving_number: reading.receivingNumber ?? null,
        receiving_account_masked: reading.receivingAccountMasked ?? null,
      },
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
