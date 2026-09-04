/**
 * Gentle, dismissible prompt to turn on phone notifications.
 *
 * Shown only once the person has come back to Universe at least once (never on
 * the very first screen), only where real push is possible, only while the
 * browser has not been asked yet, and never again after "Not now". The browser
 * permission dialog is opened from the person's own tap.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePushSetup } from "@/hooks/use-push-setup";
import { dismissPushNudge, pushNudgeDismissed } from "@/lib/notifications";

const VISITS_KEY = "wavewallet.universe-visits";

function countVisit(): number {
  if (typeof window === "undefined") return 0;
  const key = `${VISITS_KEY}:${new Date().toISOString().slice(0, 10)}`;
  if (window.sessionStorage.getItem(key)) {
    return Number(window.localStorage.getItem(VISITS_KEY) ?? "0");
  }
  window.sessionStorage.setItem(key, "1");
  const next = Number(window.localStorage.getItem(VISITS_KEY) ?? "0") + 1;
  window.localStorage.setItem(VISITS_KEY, String(next));
  return next;
}

export function PushNudge() {
  const { support, permission, enable } = usePushSetup();
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const visits = countVisit();
    setHidden(pushNudgeDismissed() || visits < 2);
  }, []);

  if (hidden || support !== "ready" || permission !== "default") return null;

  const turnOn = async () => {
    setBusy(true);
    const { result, error } = await enable();
    setBusy(false);
    if (result === "enabled") {
      dismissPushNudge();
      setHidden(true);
      toast.success("Phone notifications are on");
    } else if (result === "denied") {
      dismissPushNudge();
      setHidden(true);
    } else if (result === "error") {
      toast.error("Could not switch on phone notifications", { description: error });
    }
  };

  const notNow = () => {
    dismissPushNudge();
    setHidden(true);
  };

  return (
    <div className="mx-4 mb-3 flex items-start gap-3 rounded-2xl border border-primary/20 bg-brand-soft p-3 text-sm lg:mx-0">
      <BellRing className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Know when something happens</p>
        <p className="text-xs text-muted-foreground">
          Messages, friend requests, orders and wallet updates can reach this phone even when ONE
          WAVE is closed. Short alerts only — details stay in the app.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void turnOn()}>
            Turn on
          </Button>
          <Button size="sm" variant="ghost" onClick={notNow}>
            Not now
          </Button>
          <Link to="/universe/notifications" className="text-xs text-primary" onClick={notNow}>
            Settings
          </Link>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={notNow}
        className="rounded-full p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
