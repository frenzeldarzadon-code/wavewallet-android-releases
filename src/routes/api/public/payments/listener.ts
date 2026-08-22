/**
 * Signed ingest endpoint for the GCash notification listener companion app.
 *
 * Contract (all headers required):
 *   x-listener-device : device id issued when the device was registered
 *   x-listener-ts     : unix seconds, must be within 5 minutes of server time
 *   x-listener-nonce  : unique per request, replays are rejected
 *   x-listener-sig    : hex HMAC-SHA256 of `${device}.${ts}.${nonce}.${rawBody}`
 *                       keyed with SHA-256(pairing secret)
 *
 * A notification is corroborating evidence only. This route never credits a
 * wallet: it stores the event and asks the database to look for a single
 * matching pending Cash In. Anything ambiguous stays in the manual queue.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  hmacHex,
  signingPayload,
  timestampWithinSkew,
  timingSafeEqualHex,
} from "@/lib/listener-signature";
import { resolvePaymentProvider } from "@/lib/payment-providers";


/**
 * A heartbeat now carries the phone's own listener health. These are operational
 * facts only — never notification contents of any app.
 */
const heartbeatSchema = z.object({
  kind: z.literal("heartbeat"),
  /** Android has the NotificationListenerService bound right now. */
  listener_connected: z.boolean().optional(),
  /** Notification Access is still granted in system settings. */
  notification_access: z.boolean().optional(),
  /** How many GCash notifications the phone has seen since install. */
  received_count: z.number().int().min(0).max(10_000_000).optional(),
  last_received_at: z.string().datetime().optional(),
  app_version: z.string().max(40).optional(),
});

/**
 * The phone asking for the notification-source allow/deny rules that apply to
 * it. Carries no content; the answer is scoped to this device's own shop.
 */
const sourceRulesSchema = z.object({ kind: z.literal("source_rules") });

const eventSchema = z.object({
  kind: z.literal("event"),
  event_uid: z.string().min(6).max(200),
  package_name: z.string().min(3).max(160),
  /** Human-readable app name, when the phone could read one. Newer builds only. */
  app_label: z.string().max(160).nullable().optional(),
  /** Notification title/text, sent separately by newer builds. */
  title: z.string().max(1000).nullable().optional(),
  text: z.string().max(2000).nullable().optional(),
  posted_at: z.string().datetime().optional(),
  amount_php: z.number().positive().max(1_000_000).nullable().optional(),
  sender_number: z.string().max(40).nullable().optional(),
  sender_name: z.string().max(160).nullable().optional(),
  /** Provider reference number, when the phone could read one. */
  gcash_reference: z.string().max(64).nullable().optional(),
  reference: z.string().max(64).nullable().optional(),
  raw_text: z.string().max(2000).nullable().optional(),
  parser_version: z.string().max(40).optional(),
  /** Provider the phone believes this is. The server re-resolves it anyway. */
  provider_id: z.string().max(40).nullable().optional(),
});



const payloadSchema = z.discriminatedUnion("kind", [heartbeatSchema, eventSchema]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/payments/listener")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deviceId = request.headers.get("x-listener-device") ?? "";
        const ts = request.headers.get("x-listener-ts") ?? "";
        const nonce = request.headers.get("x-listener-nonce") ?? "";
        const signature = request.headers.get("x-listener-sig") ?? "";
        const raw = await request.text();

        if (!deviceId || !ts || !nonce || !signature) {
          return json({ accepted: false, error: "Missing signature headers" }, 401);
        }
        if (raw.length > 8000) return json({ accepted: false, error: "Payload too large" }, 413);
        if (!timestampWithinSkew(ts)) {
          return json({ accepted: false, error: "Stale or invalid timestamp" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: material } = await supabaseAdmin.rpc("listener_auth_material", {
          _device: deviceId,
        });
        const device = material as
          | { id: string; status: string; secret_key_hash: string; package_name: string }
          | null;
        if (!device) return json({ accepted: false, error: "Unknown device" }, 401);

        const expected = await hmacHex(
          device.secret_key_hash,
          signingPayload(deviceId, ts, nonce, raw),
        );
        if (!timingSafeEqualHex(expected, signature.trim().toLowerCase())) {
          return json({ accepted: false, error: "Invalid signature" }, 401);
        }
        if (device.status === "revoked") {
          return json({ accepted: false, error: "This device was revoked" }, 403);
        }

        const { data: claimed, error: nonceError } = await supabaseAdmin.rpc(
          "listener_claim_nonce",
          { _device: deviceId, _nonce: nonce },
        );
        if (nonceError) return json({ accepted: false, error: "Could not verify request" }, 500);
        if (claimed === false) return json({ accepted: false, error: "Replayed request" }, 409);

        let parsed: z.infer<typeof payloadSchema>;
        try {
          parsed = payloadSchema.parse(JSON.parse(raw || "{}"));
        } catch {
          return json({ accepted: false, error: "Invalid payload" }, 400);
        }

        if (parsed.kind === "heartbeat") {
          const health: Record<string, unknown> = { _device: deviceId };
          if (typeof parsed.listener_connected === "boolean")
            health["_listener_connected"] = parsed.listener_connected;
          if (typeof parsed.notification_access === "boolean")
            health["_notification_access"] = parsed.notification_access;
          if (typeof parsed.received_count === "number")
            health["_received_count"] = parsed.received_count;
          if (parsed.last_received_at) health["_last_received_at"] = parsed.last_received_at;
          if (parsed.app_version) health["_app_version"] = parsed.app_version;

          const { error } = await (
            supabaseAdmin.rpc as unknown as (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ error: { message: string } | null }>
          )("listener_heartbeat", health);
          if (error) return json({ accepted: false, error: "Device not accepted" }, 403);
          return json({ accepted: true, kind: "heartbeat" });
        }

        // Newer phone builds forward every notification with title/text; older
        // builds send a merged raw_text for GCash only. Both shapes work.
        const bodyText =
          parsed.raw_text ??
          [parsed.title, parsed.text]
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim() ??
          null;

        // Payment-method recognition happens here, never on the phone. An
        // unrecognised app is stored as a non-payment event by the database.
        const provider = resolvePaymentProvider(parsed.package_name, bodyText);
        const reread = provider && bodyText ? provider.parse(bodyText) : null;


        const args: Record<string, unknown> = {
          _device: deviceId,
          _event_uid: parsed.event_uid,
          _package: parsed.package_name,
        };
        const amount =
          typeof parsed.amount_php === "number" ? parsed.amount_php : (reread?.amountPhp ?? null);
        const reference =
          parsed.gcash_reference ?? parsed.reference ?? reread?.reference ?? null;
        const senderNumber = parsed.sender_number ?? reread?.senderNumber ?? null;
        const senderName = parsed.sender_name ?? reread?.senderName ?? null;

        if (bodyText) args["_raw_text"] = bodyText.slice(0, 2000);
        if (typeof amount === "number") args["_amount"] = amount;
        if (senderNumber) args["_sender_number"] = senderNumber;
        if (senderName) args["_sender_name"] = senderName;
        if (reference) args["_gcash_reference"] = reference;
        if (parsed.posted_at) args["_posted_at"] = parsed.posted_at;
        if (parsed.parser_version) args["_parser_version"] = parsed.parser_version;
        if (provider) args["_provider"] = provider.id;
        if (parsed.app_label) args["_app_label"] = parsed.app_label;


        const { data, error } = await (
          supabaseAdmin.rpc as unknown as (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>
        )("record_listener_event", args);

        // 5xx tells the phone to keep the event queued and retry; the record
        // call is idempotent, so a retry can never duplicate a payment.
        if (error) return json({ accepted: false, error: error.message }, 503);
        return json(data);
      },
    },
  },
});

