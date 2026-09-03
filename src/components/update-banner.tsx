/**
 * Subtle, non-blocking "new version" strip.
 *
 * It never reloads by itself, never appears while a purchase, transfer or cash
 * transaction is running, and can be dismissed for the session. Voucher selling
 * is never interrupted by it.
 */
import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { applyWebUpdate, checkForUpdates, type UpdateState } from "@/lib/app-update";

const DISMISS_KEY = "ww.update.dismissedBuild";

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void checkForUpdates({ background: true }).then((next) => {
        if (!cancelled && next) setState(next);
      });
    };
    // Delay the first check so it can never compete with the first paint.
    const t = setTimeout(check, 8000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const build = state?.latestWebBuild ?? "";
  const dismissed =
    typeof sessionStorage !== "undefined" && build
      ? sessionStorage.getItem(DISMISS_KEY) === build
      : false;

  if (hidden || dismissed || !state?.webUpdateAvailable) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/30 bg-card/95 px-3 py-2 shadow-lg backdrop-blur sm:bottom-4">
      <RefreshCw className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        A newer version of ONE WAVE is ready. Refresh when you finish your current sale.
      </p>
      <button
        type="button"
        onClick={() => void applyWebUpdate()}
        className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground"
      >
        Refresh
      </button>
      <button
        type="button"
        aria-label="Dismiss update notice"
        onClick={() => {
          try {
            if (build) sessionStorage.setItem(DISMISS_KEY, build);
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
        className="text-muted-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
