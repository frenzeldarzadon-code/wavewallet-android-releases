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

const heartbeatSchema = z.object({ kind: z.literal("heartbeat") });

const eventSchema = z.object({
  kind: z.literal("event"),
  event_uid: z.string().min(6).max(200),
  package_name: z.string().min(3).max(160),
  posted_at: z.string().datetime().optional(),
  amount_php: z.number().positive().max(1_000_000).nullable().optional(),
  sender_number: z.string().max(40).nullable().optional(),
  sender_name: z.string().max(160).nullable().optional(),
  raw_text: z.string().max(2000).nullable().optional(),
  parser_version: z.string().max(40).optional(),
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
          const { error } = await supabaseAdmin.rpc("listener_heartbeat", { _device: deviceId });
          if (error) return json({ accepted: false, error: "Device not accepted" }, 403);
          return json({ accepted: true, kind: "heartbeat" });
        }

        const { data, error } = await supabaseAdmin.rpc("record_listener_event", {
          _device: deviceId,
          _event_uid: parsed.event_uid,
          _package: parsed.package_name,
          _raw_text: parsed.raw_text ?? null,
          _amount: parsed.amount_php ?? null,
          _sender_number: parsed.sender_number ?? null,
          _sender_name: parsed.sender_name ?? null,
          _posted_at: parsed.posted_at ?? null,
          _parser_version: parsed.parser_version ?? null,
        });
        if (error) return json({ accepted: false, error: error.message }, 400);
        return json(data);
      },
    },
  },
});
