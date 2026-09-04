/**
 * Universe notifications.
 *
 * Rows are written by the database when something happens to you — a like, a
 * reply, a mention, a private message, a friend request, a follow, a social
 * credit gift, cashback, or a shop invitation/assignment. Reads go through a
 * function scoped to `auth.uid()`, so nobody can ever read someone else's
 * notifications, and the stored text never carries balances or private message
 * bodies.
 *
 * Phone notifications: every new row is also queued for real Web Push to each
 * of the person's registered devices (see financial-notifications.ts for the
 * device side and push-dispatch.server.ts for the sender). The in-app list is
 * always the history and the fallback.
 */
import { supabase } from "@/integrations/supabase/client";
import { FINANCIAL_CATEGORIES } from "@/lib/financial-notifications";

export interface Notification {
  id: string;
  kind: string;
  category?: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  delivery_status?: string | null;
}

export interface NotificationPreferences {
  disabledKinds: string[];
  pushEnabled: boolean;
}

export const SOCIAL_NOTIFICATION_CATEGORIES = [
  { kind: "social_like", label: "Likes on my posts" },
  { kind: "social_reply", label: "Replies to my posts and comments" },
  { kind: "social_mention", label: "Mentions of my @handle" },
  { kind: "dm_message", label: "Private messages" },
  { kind: "friend_request", label: "Friend requests" },
  { kind: "friend_accept", label: "Accepted friend requests" },
  { kind: "follow", label: "New followers" },
  { kind: "social_gift", label: "Social coin gifts" },
  { kind: "shop_invitation", label: "Shop invitations and applications" },
  { kind: "shop_assignment", label: "Shop admin and membership assignments" },
] as const;

export const NOTIFICATION_CATEGORIES = [
  ...FINANCIAL_CATEGORIES,
  ...SOCIAL_NOTIFICATION_CATEGORIES,
] as ReadonlyArray<{ kind: string; label: string }>;

/** What is still missing before real background push can be switched on. */
export const PUSH_REQUIREMENTS = [
  "A service worker registered for this site",
  "A VAPID key pair stored as platform secrets",
  "A push delivery endpoint that stores browser subscriptions",
] as const;

function fail(message: string): never {
  throw new Error(message);
}

export async function fetchNotifications(limit = 50): Promise<Notification[]> {
  const { data, error } = await supabase.rpc("my_notifications", { _limit: limit });
  if (error) fail(error.message);
  return (data ?? []) as Notification[];
}

export function unreadCount(rows: Notification[]): number {
  return rows.filter((r) => !r.read_at).length;
}

export async function markRead(ids?: string[]) {
  const { error } = await supabase.rpc("mark_notifications_read", ids ? { _ids: ids } : {});
  if (error) fail(error.message);
}

export async function fetchPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("disabled_kinds, push_enabled")
    .maybeSingle();
  if (error) fail(error.message);
  return {
    disabledKinds: data?.disabled_kinds ?? [],
    pushEnabled: data?.push_enabled ?? false,
  };
}

export async function savePreferences(prefs: NotificationPreferences) {
  const { error } = await supabase.rpc("set_notification_preferences", {
    _disabled_kinds: prefs.disabledKinds,
    _push_enabled: prefs.pushEnabled,
  });
  if (error) fail(error.message);
}

export function toggleCategory(disabled: string[], kind: string, enabled: boolean): string[] {
  const without = disabled.filter((k) => k !== kind);
  return enabled ? without : [...without, kind];
}

/** Where a notification takes you. Falls back to the feed for older rows. */
export function notificationLink(n: Notification): string {
  return n.link && n.link.startsWith("/") ? n.link : "/universe";
}

/** Browser notification support, without assuming a service worker exists. */
export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): "default" | "granted" | "denied" | "unsupported" {
  if (!browserNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Always asks — never enables notifications silently. */
export async function requestNotificationPermission(): Promise<
  "granted" | "denied" | "default" | "unsupported"
> {
  if (!browserNotificationsSupported()) return "unsupported";
  return (await Notification.requestPermission()) as "granted" | "denied" | "default";
}

/** Foreground alert for a freshly arrived notification. No-op without consent. */
export function showBrowserNotification(n: Notification) {
  if (notificationPermission() !== "granted") return;
  try {
    new Notification(n.title, { ...(n.body ? { body: n.body } : {}), tag: n.id });
  } catch {
    /* the browser may refuse outside a user gesture — the in-app list still shows it */
  }
}
