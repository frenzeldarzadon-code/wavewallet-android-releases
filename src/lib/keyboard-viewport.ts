/**
 * Mobile keyboard awareness.
 *
 * Android/iOS browsers do NOT shrink the layout viewport when the on-screen
 * keyboard opens, so `100dvh` dialogs keep their bottom action row underneath
 * the keyboard. The visual viewport does shrink, so we measure it and expose
 * the covered height as an inset that callers can apply to a dialog.
 *
 * Presentation only — nothing here touches pricing, wallets or accounting.
 */
import { useEffect, useState } from "react";

export interface KeyboardViewport {
  /** Pixels of the window currently covered by the keyboard (0 when closed). */
  keyboardInset: number;
  /** Usable visual viewport height, or null before/without measurement. */
  viewportHeight: number | null;
}

export const KEYBOARD_OPEN_THRESHOLD = 120;

/** Pure measurement so the behaviour is testable without a browser. */
export function computeKeyboardViewport(
  innerHeight: number,
  visual: { height: number; offsetTop: number } | null,
): KeyboardViewport {
  if (!visual || !Number.isFinite(visual.height) || visual.height <= 0)
    return { keyboardInset: 0, viewportHeight: null };
  const covered = Math.max(0, Math.round(innerHeight - visual.height - visual.offsetTop));
  return {
    keyboardInset: covered >= KEYBOARD_OPEN_THRESHOLD ? covered : 0,
    viewportHeight: Math.round(visual.height),
  };
}

/** Live keyboard inset while `active` (typically: while a dialog is open). */
export function useKeyboardViewport(active: boolean): KeyboardViewport {
  const [state, setState] = useState<KeyboardViewport>({
    keyboardInset: 0,
    viewportHeight: null,
  });

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      setState({ keyboardInset: 0, viewportHeight: null });
      return;
    }
    const vp = window.visualViewport ?? null;
    const measure = () =>
      setState(
        computeKeyboardViewport(
          window.innerHeight,
          vp ? { height: vp.height, offsetTop: vp.offsetTop } : null,
        ),
      );
    measure();
    vp?.addEventListener("resize", measure);
    vp?.addEventListener("scroll", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      vp?.removeEventListener("resize", measure);
      vp?.removeEventListener("scroll", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [active]);

  return state;
}
