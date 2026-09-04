/**
 * One place that knows how to switch phone notifications on for this browser:
 * ask the browser (only ever from the person's own tap), create the push
 * subscription, register it to the signed-in account and turn the account
 * setting on. Also refreshes an existing subscription quietly on app start so
 * rotated endpoints keep working.
 */
import { useCallback, useEffect, useState } from "react";
import {
  pushSupport,
  registerThisDevice,
  unsubscribeThisDevice,
  type PushSupport,
} from "@/lib/financial-notifications";
import {
  fetchPreferences,
  notificationPermission,
  requestNotificationPermission,
  savePreferences,
  type NotificationPreferences,
} from "@/lib/notifications";

export type EnableResult = "enabled" | "denied" | "dismissed" | "unavailable" | "error";

export function usePushSetup() {
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [permission, setPermission] = useState(notificationPermission());

  useEffect(() => {
    let alive = true;
    void pushSupport().then((s) => alive && setSupport(s));
    setPermission(notificationPermission());
    return () => {
      alive = false;
    };
  }, []);

  const enable = useCallback(
    async (prefs?: NotificationPreferences): Promise<{ result: EnableResult; error?: string }> => {
      const s = await pushSupport();
      setSupport(s);
      if (s !== "ready") return { result: "unavailable" };
      const granted = await requestNotificationPermission();
      setPermission(granted);
      if (granted === "denied") return { result: "denied" };
      if (granted !== "granted") return { result: "dismissed" };
      try {
        const current = prefs ?? (await fetchPreferences());
        const reg = await registerThisDevice({ subscribe: true });
        if (!reg.pushCapable) {
          return { result: "error", error: "This browser did not provide a push subscription." };
        }
        if (!current.pushEnabled) await savePreferences({ ...current, pushEnabled: true });
        return { result: "enabled" };
      } catch (e) {
        return { result: "error", error: (e as Error).message };
      }
    },
    [],
  );

  const disableHere = useCallback(async () => {
    await unsubscribeThisDevice();
  }, []);

  return { support, permission, enable, disableHere };
}

/**
 * Silent refresh on app start: when the browser already allowed notifications
 * and the account has push on, re-register the current subscription so a
 * rotated endpoint is never left stale. Never asks for permission.
 */
export function useRefreshPushRegistration(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    if (notificationPermission() !== "granted") return;
    let alive = true;
    void (async () => {
      if ((await pushSupport()) !== "ready") return;
      const prefs = await fetchPreferences().catch(() => null);
      if (!alive || !prefs?.pushEnabled) return;
      await registerThisDevice({ subscribe: true }).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);
}
