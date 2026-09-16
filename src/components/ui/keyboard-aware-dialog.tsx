/**
 * Dialog shell that stays usable while the mobile keyboard is open.
 *
 * On phones the dialog is a bottom sheet whose height follows the visual
 * viewport, so the body scrolls freely and the footer actions (e.g. "Confirm &
 * Generate Vouchers") always sit above the keyboard. Desktop keeps the normal
 * centred dialog. Layout only — no business logic lives here.
 */
import * as React from "react";
import { DialogContent } from "@/components/ui/dialog";
import { useKeyboardViewport } from "@/lib/keyboard-viewport";
import { cn } from "@/lib/utils";

export function KeyboardAwareDialogContent({
  open,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogContent> & { open: boolean }) {
  const { keyboardInset, viewportHeight } = useKeyboardViewport(open);
  const style: React.CSSProperties = { ...(props.style ?? {}) };
  if (keyboardInset > 0) style.bottom = `${keyboardInset}px`;
  if (viewportHeight !== null) style.maxHeight = `${viewportHeight}px`;

  return (
    <DialogContent
      {...props}
      style={style}
      className={cn(
        "bottom-0 left-0 top-auto flex max-h-[100dvh] w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-xl p-0",
        "sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-h-[92dvh] sm:max-w-sm sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg",
        "[&>button]:top-[max(1rem,env(safe-area-inset-top))] sm:[&>button]:top-4",
        className,
      )}
    >
      {children}
    </DialogContent>
  );
}

/** Scrollable middle region; brings the focused field into view. */
export function KeyboardAwareDialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onFocusCapture={(event) => {
        const el = event.target as HTMLElement | null;
        if (!el || !("scrollIntoView" in el)) return;
        window.setTimeout(
          () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
          250,
        );
      }}
      className={cn(
        "min-h-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overscroll-contain px-4 py-3 scroll-pb-24 pb-8 [-webkit-overflow-scrolling:touch] sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
