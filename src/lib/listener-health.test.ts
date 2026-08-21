/**
 * A paired phone that keeps sending heartbeats can still be useless: Android
 * may have unbound the notification listener, or the user may have revoked
 * Notification Access. Those failures must be named, not hidden behind a
 * green "Online" badge.
 */
import { describe, expect, it } from "vitest";
import { deviceHealthLine, deviceStateLabel, type ListenerDevice } from "./listener-devices";

const device = (extra: Partial<ListenerDevice> = {}): ListenerDevice => ({
  id: "d1",
  label: "Shop phone",
  status: "active",
  ecosystem_id: null,
  ecosystem_name: null,
  package_name: "com.globe.gcash.android",
  match_window_minutes: 30,
  offline_after_minutes: 30,
  created_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  last_event_at: null,
  revoked_at: null,
  online: true,
  accepted_events: 0,
  unparsed_events: 0,
  matched_cash_ins: 0,
  last_match_at: null,
  ...extra,
});

describe("listener device health", () => {
  it("shows a disconnected Android listener even while heartbeats arrive", () => {
    const state = deviceStateLabel(device({ listener_connected: false, online: true }));
    expect(state.label).toBe("Listener disconnected");
    expect(state.tone).toBe("danger");
  });

  it("calls out lost notification access first", () => {
    const state = deviceStateLabel(
      device({ notification_access: false, listener_connected: false }),
    );
    expect(state.label).toBe("Notification access lost");
  });

  it("stays online when the phone reports a healthy listener", () => {
    expect(deviceStateLabel(device({ listener_connected: true, notification_access: true })).label).toBe(
      "Online",
    );
  });

  it("summarises health in plain language", () => {
    const line = deviceHealthLine(
      device({
        listener_connected: true,
        notification_access: true,
        received_count: 7,
        app_version: "1.3.0",
      }),
    );
    expect(line).toContain("Notification access ON");
    expect(line).toContain("Android listener connected");
    expect(line).toContain("7 GCash notification(s) seen");
    expect(line).toContain("app 1.3.0");
  });
});
