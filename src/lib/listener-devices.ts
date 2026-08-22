/**
 * Platform-owner client helpers for the GCash notification listener devices.
 *
 * A listener device is a paired Android phone that forwards GCash notification
 * text. It corroborates a Cash In; it never releases credits on its own.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * Calls an RPC by name for functions that are not in the generated types yet.
 * The call must stay attached to the client: a detached `supabase.rpc`
 * reference loses `this` and throws "Cannot read properties of undefined
 * (reading 'rest')".
 */
const rpc = (
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> =>
  (
    supabase.rpc as unknown as (
      name: string,
      params?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);


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
  /** Android reported the notification listener bound at the last heartbeat. */
  listener_connected?: boolean | null;
  /** Notification Access still granted in the phone's system settings. */
  notification_access?: boolean | null;
  listener_state_at?: string | null;
  /** GCash notifications the phone has seen, and when the last one arrived. */
  received_count?: number | null;
  last_received_at?: string | null;
  app_version?: string | null;
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
  const { data, error } = await rpc("register_listener_device", args);
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

/**
 * Issues a fresh one-time pairing secret for a phone that is already known.
 * The device keeps its id, the old credential stops working immediately, and
 * only the platform owner or that shop's admin may do this.
 */
export async function repairListenerDevice(deviceId: string) {
  const { data, error } = await rpc("repair_listener_device", { _device: deviceId });
  if (error) throw error;
  return data as {
    device_id: string;
    label: string;
    pairing_secret: string;
    package_name: string;
    receiving_number: string | null;
  };
}


/** One incoming GCash payment that has not been attached to a Cash In yet. */
export type UnmatchedListenerEvent = {
  id: string;
  device_id: string;
  device_label: string;
  receiving_number: string | null;
  ecosystem_id: string | null;
  ecosystem_name: string | null;
  /** Which payment provider recognised this notification (e.g. "gcash"). */
  provider_id: string | null;
  /** App name the phone reported, when it could read one. */
  app_label: string | null;
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
    /** Independent details that agree: reference, sending account, amount. */
    signals?: number;
    /** At least one non-amount detail agrees. */
    strong?: boolean;
    /** Two independent signals with a non-amount signal present. */
    auto_matchable?: boolean;
  }[];

};


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
  // The app process staying alive proves nothing: Android can drop the
  // notification listener while heartbeats keep arriving. Those two failures
  // are named separately so the operator knows what to fix on the phone.
  if (device.notification_access === false)
    return { label: "Notification access lost", tone: "danger" as const };
  if (device.listener_connected === false)
    return { label: "Listener disconnected", tone: "danger" as const };
  if (!device.online) return { label: "Offline", tone: "danger" as const };
  return { label: "Online", tone: "success" as const };
}

/** One-line plain-language health summary for a paired phone. */
export function deviceHealthLine(device: ListenerDevice) {
  const parts: string[] = [];
  parts.push(
    device.notification_access === false
      ? "Notification access OFF"
      : device.notification_access === true
        ? "Notification access ON"
        : "Notification access unknown",
  );
  parts.push(
    device.listener_connected === false
      ? "Android listener DISCONNECTED"
      : device.listener_connected === true
        ? "Android listener connected"
        : "Listener state unknown",
  );
  if (typeof device.received_count === "number")
    parts.push(`${device.received_count} GCash notification(s) seen`);
  if (device.app_version) parts.push(`app ${device.app_version}`);
  return parts.join(" · ");
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
  if (result === "wrong_shop") {
    return "That phone is paired to a different shop, so it cannot settle this request";
  }
  if (result === "destination_mismatch") {
    return (
      "Informational: GCash showed a different or masked receiving number. This does not block " +
      "approval — it is kept for audit only"
    );
  }
  if (result === "device_without_receiving_number") {
    return "This phone has no receiving GCash account set — kept for review";
  }
  return "Recorded";
}

