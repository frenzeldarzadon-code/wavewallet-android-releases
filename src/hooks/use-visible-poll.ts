import { useEffect, useRef } from "react";

/**
 * Runs `task` once, then every `intervalMs` — but only while the tab is
 * actually being looked at.
 *
 * Background tabs used to keep refetching notifications and controller health
 * every minute, which costs the phone battery and the server requests for
 * nothing. When the tab is hidden the tick is skipped; the moment it becomes
 * visible again the task runs immediately, so the user never sees stale data.
 *
 * `task` is kept in a ref so callers may pass an inline closure without
 * restarting the timer on every render.
 */
export function useVisiblePoll(task: () => void, intervalMs: number, resetKey?: unknown): void {
  const latest = useRef(task);
  latest.current = task;

  useEffect(() => {
    const run = () => latest.current();
    run();
    const timer = window.setInterval(() => {
      if (!document.hidden) run();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `resetKey` lets a caller re-run immediately when what it polls FOR changes
    // (e.g. the active shop finished loading, or the user switched shop).
  }, [intervalMs, resetKey]);
}
