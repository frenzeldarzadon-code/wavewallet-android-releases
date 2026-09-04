/**
 * Manual-review helper: the customer's receipt (sender view) side by side with
 * the listener notification (receiver view), plus a per-field explanation of
 * what agreed and what did not. Read-only; the database decides everything.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Check, X, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Signal = {
  signal: string;
  category: "identity" | "supporting" | "informational";
  receipt_label?: string;
  notification_label?: string;
  receipt: unknown;
  notification: unknown;
  agreed: boolean;
};

export type MatchExplanation = {
  cash_in_id: string;
  status: string;
  viewpoints: { receipt: string; notification: string; note: string };
  receipt: Record<string, unknown> & { details?: Record<string, unknown> | null };
  notification:
    | (Record<string, unknown> & { raw_text?: string; details?: Record<string, unknown> | null })
    | null;
  signals: Signal[];
  independent_matches: number;
  auto_candidate: boolean;
  duplicate_of_credited: string | null;
  blockers: string[] | null;
};

export async function fetchMatchExplanation(cashInId: string): Promise<MatchExplanation | null> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "cash_in_match_explanation", { _id: cashInId });
  if (error) throw new Error(error.message);
  return (data as MatchExplanation | null) ?? null;
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Flattens one side (top-level fields + nested `details`/`fields`) into label/value rows. */
function rows(side: Record<string, unknown> | null | undefined): [string, string][] {
  if (!side) return [];
  const out: [string, string][] = [];
  const skip = new Set([
    "details",
    "raw_text",
    "proof_path",
    "proof_hash",
    "event_id",
    "device_id",
  ]);
  for (const [k, v] of Object.entries(side))
    if (!skip.has(k)) out.push([k.replace(/_/g, " "), show(v)]);
  const details = side["details"] as Record<string, unknown> | null | undefined;
  if (details) {
    for (const [k, v] of Object.entries(details)) {
      if (k === "raw_text" || k === "fields" || k === "labeled_fields") continue;
      out.push([`detail · ${k.replace(/_/g, " ")}`, show(v)]);
    }
    const printed = (details["fields"] ?? details["labeled_fields"]) as
      Record<string, unknown> | undefined;
    if (printed)
      for (const [k, v] of Object.entries(printed)) out.push([`printed · ${k}`, show(v)]);
  }
  return out;
}

function Side({
  title,
  subtitle,
  side,
}: {
  title: string;
  subtitle: string;
  side: Record<string, unknown> | null;
}) {
  const raw = (side?.["raw_text"] ??
    (side?.["details"] as Record<string, unknown> | undefined)?.["raw_text"]) as string | undefined;
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <p className="font-semibold">{title}</p>
      <p className="mb-1 text-muted-foreground">{subtitle}</p>
      {!side ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-2 gap-y-0.5">
          {rows(side).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {raw ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground">Full text as read</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">
            {raw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function CashInMatchExplanation({ cashInId }: { cashInId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MatchExplanation | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data === undefined) {
      try {
        setData(await fetchMatchExplanation(cashInId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the comparison.");
        setData(null);
      }
    }
  };

  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void toggle()}>
        {open ? <ChevronUp className="mr-1 size-3.5" /> : <ChevronDown className="mr-1 size-3.5" />}
        Compare receipt (sender view) with notification (receiver view)
      </Button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          {error ? <p className="text-destructive">{error}</p> : null}
          {data === undefined && !error ? <p className="text-muted-foreground">Loading…</p> : null}
          {data ? (
            <>
              <p className="text-muted-foreground">{data.viewpoints.note}</p>
              <div className="grid gap-2 md:grid-cols-2">
                <Side
                  title="Customer receipt"
                  subtitle="Sender / payer view — what the customer sent"
                  side={data.receipt}
                />
                <Side
                  title="Listener notification"
                  subtitle="Receiver / payee view — what the platform account received"
                  side={data.notification}
                />
              </div>
              <div className="rounded-md border border-border bg-background p-2">
                <p className="font-semibold">
                  Field comparison · {data.independent_matches} independent match
                  {data.independent_matches === 1 ? "" : "es"}
                  {data.auto_candidate
                    ? " · candidate for automatic approval"
                    : " · needs at least 2"}
                </p>
                {data.signals.length === 0 ? (
                  <p className="text-muted-foreground">
                    No notification is linked, so nothing can be compared yet.
                  </p>
                ) : (
                  <table className="mt-1 w-full">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left font-normal">Receipt says</th>
                        <th className="text-left font-normal">Notification says</th>
                        <th className="text-left font-normal">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.signals
                        .filter((s) => s.category !== "informational")
                        .map((s) => (
                          <tr key={s.signal} className="border-t border-border/60 align-top">
                            <td className="py-0.5 pr-2">
                              <span className="text-muted-foreground">
                                {s.receipt_label ?? s.signal}:
                              </span>{" "}
                              {show(s.receipt)}
                            </td>
                            <td className="py-0.5 pr-2">
                              <span className="text-muted-foreground">
                                {s.notification_label ?? s.signal}:
                              </span>{" "}
                              {show(s.notification)}
                            </td>
                            <td className="py-0.5">
                              {s.agreed ? (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <Check className="size-3.5" /> agree
                                </span>
                              ) : s.receipt == null || s.notification == null ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Minus className="size-3.5" /> not on both sides
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <X className="size-3.5" /> differ
                                </span>
                              )}
                              {s.category === "supporting" ? (
                                <span className="ml-1 text-muted-foreground">(supporting)</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-1 text-muted-foreground">
                  Supporting details (amount, recipient account, time) only count once an identity
                  detail (reference, sending account or payer name) agrees.
                </p>
              </div>
              {data.duplicate_of_credited ? (
                <p className="font-medium text-destructive">
                  Duplicate: the same receipt / reference / payment fingerprint was already credited
                  (request {data.duplicate_of_credited.slice(0, 8)}…).
                </p>
              ) : null}
              {data.blockers && data.blockers.length > 0 ? (
                <p className="text-muted-foreground">
                  Why not automatic: {data.blockers.map((b) => b.replace(/_/g, " ")).join(", ")}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
