/**
 * Verified incoming payment feed (webhook).
 *
 * This is the ONLY way a payment becomes "verified". An authorised provider —
 * one that actually observes the receiving GCash/bank account — posts settled
 * transactions here, signed with the shared secret held in
 * PAYMENT_FEED_WEBHOOK_SECRET. Screenshots uploaded by members never reach this
 * endpoint and are never treated as proof of payment.
 *
 * Unsigned, mis-signed, replayed or malformed calls are rejected before any
 * database work happens.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  provider: z.string().min(1).max(40),
  transaction_id: z.string().min(1).max(120),
  amount_php: z.number().finite().positive().max(1_000_000),
  paid_at: z.string().datetime().optional(),
  reference: z.string().max(120).nullish(),
  payer_name: z.string().max(120).nullish(),
  payer_account: z.string().max(120).nullish(),
});

function signatureMatches(secret: string, body: string, header: string | null): boolean {
  if (!header) return false;
  const provided = header.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/payments/feed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["PAYMENT_FEED_WEBHOOK_SECRET"];
        if (!secret) {
          // Nothing is trusted until the operator configures the shared secret.
          return new Response("Payment feed is not configured", { status: 503 });
        }
        const raw = await request.text();
        if (raw.length > 20_000) return new Response("Payload too large", { status: 413 });
        if (!signatureMatches(secret, raw, request.headers.get("x-payment-signature"))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const result = payloadSchema.safeParse(parsed);
        if (!result.success) return new Response("Invalid payload", { status: 400 });
        const event = result.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("record_verified_payment", {
          _provider: event.provider,
          _txn_id: event.transaction_id,
          _amount_php: event.amount_php,
          _paid_at: event.paid_at ?? new Date().toISOString(),
          _reference: event.reference ?? null,
          _payer_name: event.payer_name ?? null,
          _payer_account: event.payer_account ?? null,
          _raw: event as unknown as Record<string, unknown>,
        } as never);

        if (error) {
          return Response.json({ accepted: false, error: "Could not record payment" }, { status: 500 });
        }
        // Deliberately terse: never echo member or request details back to the
        // provider. `result` is one of stored / approved / duplicate_event.
        const outcome = (data as { result?: string } | null)?.result ?? "stored";
        return Response.json({ accepted: true, outcome });
      },
    },
  },
});
