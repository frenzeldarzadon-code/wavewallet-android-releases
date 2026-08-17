/**
 * Platform-owner client helpers for the GCash notification listener devices.
 *
 * A listener device is a paired Android phone that forwards GCash notification
 * text. It corroborates a Cash In; it never releases credits on its own.
 */
import { supabase } from "@/integrations/supabase/client";

export type ListenerDevice = {
  id: string;
  label: string;
  status: "pending" | "active" | "revoked";
  ecosystem_id: string | null;
  ecosystem_name: string | null;
  package_name: string;
  /** Platform-owned phone, or a phone paired by a shop admin for their shop. */
  owner_role?: "platform" | "admin";
  /** The receiving GCash account this phone monitors. Matching is scoped to it. */
  receiving_number?: string | null;
  /** How many shops receive Cash In on that same account. */
  shops_served?: number;
  match_window_minutes: number;
  offline_after_minutes: number;
  created_at: string;
  last_seen_at: string | null;
  last_event_at: string | null;
  revoked_at: string | null;
  online: boolean;
  accepted_events: number;
  unparsed_events: number;
  matched_cash_ins: number;
  last_match_at: string | null;
};


export type ListenerEvent = {
  id: string;
  device_id: string;
  outcome: string;
  match_result: string | null;
  amount_php: number | null;
  sender_number: string | null;
  sender_name: string | null;
  posted_at: string | null;
  created_at: string;
  consumed_cash_in_id: string | null;
};

export type ListenerStatus = { devices: ListenerDevice[]; recent_events: ListenerEvent[] };

export const LISTENER_ENDPOINT_PATH = "/api/public/payments/listener";

export async function fetchListenerStatus(): Promise<ListenerStatus> {
  const { data, error } = await supabase.rpc("listener_device_status");
  if (error) throw error;
  const value = (data ?? {}) as Partial<ListenerStatus>;
  return { devices: value.devices ?? [], recent_events: value.recent_events ?? [] };
}

export async function registerListenerDevice(input: {
  label: string;
  ecosystemId?: string | null;
  windowMinutes?: number;
  offlineMinutes?: number;
  /** Receiving GCash account the phone monitors. Required by the database. */
  receivingNumber?: string | null;
}) {
  const args: Record<string, unknown> = {
    _label: input.label,
    _window_minutes: input.windowMinutes ?? 60,
    _offline_minutes: input.offlineMinutes ?? 15,
  };
  if (input.ecosystemId) args["_ecosystem"] = input.ecosystemId;
  if (input.receivingNumber) args["_receiving_number"] = input.receivingNumber;
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("register_listener_device", args);
  if (error) throw error;
  return data as {
    device_id: string;
    label: string;
    pairing_secret: string;
    package_name: string;
    receiving_number: string | null;
  };
}



export async function revokeListenerDevice(deviceId: string) {
  const { error } = await supabase.rpc("revoke_listener_device", { _device: deviceId });
  if (error) throw error;
}

/** One incoming GCash payment that has not been attached to a Cash In yet. */
export type UnmatchedListenerEvent = {
  id: string;
  device_id: string;
  device_label: string;
  receiving_number: string | null;
  ecosystem_id: string | null;
  ecosystem_name: string | null;
  amount_php: number | null;
  sender_number: string | null;
  sender_name: string | null;
  gcash_reference: string | null;
  posted_at: string | null;
  created_at: string;
  outcome: string;
  match_result: string | null;
  review_state: string;
  review_note: string | null;
  raw_text: string | null;
  candidates: {
    cash_in_id: string;
    reference: string | null;
    amount_php: number;
    created_at: string;
    ecosystem_name: string | null;
    member_name: string | null;
    member_handle: string | null;
  }[];
};

const rpc = supabase.rpc as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Received payments waiting for a human to attach them to a Cash In. */
export async function fetchUnmatchedListenerEvents(): Promise<UnmatchedListenerEvent[]> {
  const { data, error } = await rpc("listener_unmatched_events", { _limit: 100 });
  if (error) throw error;
  return (data ?? []) as UnmatchedListenerEvent[];
}

/** Attaches a received payment to a pending Cash In. Approval still applies. */
export async function linkListenerEvent(eventId: string, cashInId: string, note?: string) {
  const { error } = await rpc("link_listener_event", {
    _event: eventId,
    _cash_in: cashInId,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}

/** Sets a received payment aside without touching any wallet. */
export async function dismissListenerEvent(eventId: string, note?: string) {
  const { error } = await rpc("dismiss_listener_event", {
    _event: eventId,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}


/** Plain-language state for one device. */
export function deviceStateLabel(device: ListenerDevice) {
  if (device.status === "revoked") return { label: "Revoked", tone: "danger" as const };
  if (device.status === "pending") return { label: "Waiting to pair", tone: "warning" as const };
  if (!device.online) return { label: "Offline", tone: "danger" as const };
  return { label: "Online", tone: "success" as const };
}

/** Plain-language outcome of one forwarded notification. */
export function eventResultLabel(event: ListenerEvent) {
  if (event.outcome === "unparsed") return "Could not read an amount — kept for review";
  const result = event.match_result ?? "";
  if (result.startsWith("matched:approved")) return "Matched and approved automatically";
  if (result.startsWith("matched:staged")) return "Matched — staged mode, nothing was settled";
  if (result.startsWith("matched:")) return `Matched, not approved (${result.slice(8).replace(/_/g, " ")})`;
  if (result === "ambiguous") return "Several possible Cash Ins — left for manual review";
  if (result === "no_pending_match") return "No pending Cash In matched";
  if (result === "device_without_receiving_number") {
    return "This phone has no receiving GCash account set — nothing was matched";
  }
  return "Recorded";
}

