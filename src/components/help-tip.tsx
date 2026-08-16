/**
 * Contextual help: a small "(i)" control that explains a feature in plain
 * language, plus a global Show guide / Hide guide preference.
 *
 * Hiding only suppresses these inline explanations — the full Guide tab at
 * /help always stays reachable.
 */
import { Info } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const KEY = "ww.help.visible";
const EVENT = "ww:help-visibility";

export function readHelpVisible(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEY) !== "0";
}

export function setHelpVisible(next: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, next ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Subscribes to the global Show guide / Hide guide preference. */
export function useHelpVisible(): [boolean, (next: boolean) => void] {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const sync = () => setVisible(readHelpVisible());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: boolean) => {
    setHelpVisible(next);
    setVisible(next);
  }, []);

  return [visible, update];
}

interface Props {
  /** Short heading, e.g. "Coins". */
  title: string;
  /** Plain-language explanation. */
  children: React.ReactNode;
  /** Optional WiFi voucher example, shown in a tinted box. */
  example?: string;
  className?: string;
}

export function HelpTip({ title, children, example, className }: Props) {
  const [visible] = useHelpVisible();
  if (!visible) return null;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What is ${title}?`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
      >
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="font-semibold tracking-tight">{title}</p>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
        {example ? (
          <p className="mt-2 rounded-lg bg-muted px-2.5 py-2 text-xs leading-relaxed">
            <span className="font-medium">Example: </span>
            {example}
          </p>
        ) : null}
        <Link to="/help" className="mt-2 inline-block text-xs font-medium text-primary">
          Open the full guide →
        </Link>
      </PopoverContent>
    </Popover>
  );
}
