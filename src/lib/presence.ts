/**
 * Member presence — ONE mechanism for the whole app.
 *
 * Source of truth: `member_presence.last_seen_at`, written only by the
 * `touch_member_presence` RPC for the *authenticated* caller (auth.uid()).
 * It is never derived from profile edits, purchases or other DB writes.
 *
 * Heartbeat: every 60 s while the app tab is visible; paused when hidden or
 * backgrounded, touched again on return. The server treats a member as
 * "online" when last_seen_at is within `presence_online_window()` = 2 minutes,
 * so closing the app drops them to "Online X min ago" within ~2 minutes.
 */
import { supabase } from "@/integrations/supabase/client";

export const PRESENCE_HEARTBEAT_MS = 60_000;
/** Mirrors public.presence_online_window() — keep both in sync. */
export const PRESENCE_ONLINE_WINDOW_MS = 2 * 60_000;

export interface PresenceInfo {
  /** Server-decided: seen within the online window at query time. */
  online: boolean;
  /** Minute-rounded last activity (coarse on purpose), null = never seen. */
  lastSeenAt: string | null;
}

export type PresenceTone = "online" | "recent" | "away" | "unknown";

/** Coarse status label — never exposes exact timestamps. */
export function presenceLabel(p: PresenceInfo, now: Date = new Date()): string {
  if (p.online) return "Online";
  if (!p.lastSeenAt) return "Not seen recently";
  const diff = Math.max(0, now.getTime() - new Date(p.lastSeenAt).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Online";
  if (mins < 60) return `Online ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Online ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Online ${days} day${days === 1 ? "" : "s"} ago`;
  return "Not seen recently";
}

/** Visual tone for the status dot. */
export function presenceTone(p: PresenceInfo, now: Date = new Date()): PresenceTone {
  if (p.online) return "online";
  if (!p.lastSeenAt) return "unknown";
  const diff = now.getTime() - new Date(p.lastSeenAt).getTime();
  return diff < 60 * 60_000 ? "recent" : "away";
}

/**
 * Presence-first ordering (client-side mirror of the server ORDER BY, used
 * to re-sort cached lists as time passes): online → most recent → name.
 */
export function sortByPresence<T extends PresenceInfo & { sellerName: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : -Infinity;
    const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.sellerName.localeCompare(b.sellerName);
  });
}

let heartbeatStops = 0;
let stop: (() => void) | null = null;

/**
 * Start the app-wide heartbeat for the signed-in member. Reference-counted so
 * multiple mounts share ONE timer. Returns a stop function.
 */
export function startPresenceHeartbeat(): () => void {
  heartbeatStops += 1;
  if (!stop && typeof window !== "undefined") {
    let timer: number | null = null;
    const touch = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) void supabase.rpc("touch_member_presence");
      });
    };
    const arm = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(touch, PRESENCE_HEARTBEAT_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        touch();
        arm();
      } else if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    touch();
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", touch);
    stop = () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", touch);
    };
  }
  return () => {
    heartbeatStops -= 1;
    if (heartbeatStops <= 0 && stop) {
      stop();
      stop = null;
      heartbeatStops = 0;
    }
  };
}
