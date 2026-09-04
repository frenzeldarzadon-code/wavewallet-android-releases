/**
 * Platform (Universe) cash in — what is accepted and what the listener covers.
 *
 * Reads `platform_cash_in_readiness()`, a member-safe summary derived from the
 * existing configuration: the platform receiving accounts (`payment_methods`
 * with no shop), the platform listener devices and the platform auto-approval
 * rule. Nothing here is a second configuration — it only describes the one that
 * already exists. Two renderings share the same data:
 *
 *  - `PlatformCashInStatus`  — member-facing, on the Universe wallet Cash In tab.
 *  - `PlatformListenerCoverageCard` — Super Admin, on /super/settings.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";

export type PlatformCashInMethod = {
  id: string;
  name: string;
  method_type: string;
  account_tail: string;
  listener_watching: boolean;
  listener_online: boolean;
};

export type PlatformCashInReadiness = {
  auto_enabled: boolean;
  require_listener_match: boolean;
  max_auto_amount_php: number | null;
  methods: PlatformCashInMethod[];
};

export async function fetchPlatformCashInReadiness(): Promise<PlatformCashInReadiness | null> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, "platform_cash_in_readiness");
  if (error || !data) return null;
  return data as PlatformCashInReadiness;
}

/** Plain-language verification state for one receiving account. */
export function methodVerificationLabel(
  m: PlatformCashInMethod,
  autoEnabled: boolean,
): { label: string; tone: "success" | "warning" | "muted" } {
  // The platform listener is not paired per account: one health state applies to every method.
  if (!m.listener_watching) return { label: "No listener · manual review", tone: "muted" };
  if (!m.listener_online) return { label: "Listener offline · manual review", tone: "warning" };
  if (!autoEnabled) return { label: "Listener on · manual release", tone: "warning" };
  return { label: "Receipt + notification · auto", tone: "success" };
}

function useReadiness() {
  const [state, setState] = useState<PlatformCashInReadiness | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchPlatformCashInReadiness().then((r) => {
      if (live) setState(r);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function MethodRows({ data }: { data: PlatformCashInReadiness }) {
  if (data.methods.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No platform receiving account is published yet.
      </p>
    );
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {data.methods.map((m) => {
        const v = methodVerificationLabel(m, data.auto_enabled);
        return (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm"
          >
            <span>
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {m.method_type === "ewallet" ? "e-wallet" : m.method_type}
                {m.account_tail ? ` · ····${m.account_tail}` : ""}
              </span>
            </span>
            <StatusBadge tone={v.tone}>{v.label}</StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}

/** Member view on the Universe wallet: who verifies the payment and how. */
export function PlatformCashInStatus() {
  const data = useReadiness();
  if (data === undefined) return null;
  if (data === null) return null;
  const anyOnline = data.methods.some((m) => m.listener_online);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Radio className="size-4 text-primary" /> Platform cash in · verified by the platform
        listener
      </p>
      <p>
        This is a platform (Super Admin) cash in for your one global Universe wallet — no shop is
        involved. Pay into one of the platform accounts below, then submit your request with the
        reference and your receipt. The platform listener captures notifications from every
        supported payment app; coins are added automatically only when your receipt and a real
        notification agree on at least two details (amount, reference, sending account…) and the
        receipt was never credited before. Anything unclear is reviewed by the platform owner; a
        screenshot alone never releases coins.
      </p>
      <MethodRows data={data} />
      <p className="flex items-start gap-1.5">
        {anyOnline && data.auto_enabled ? (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
        ) : (
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
        )}
        <span>
          {anyOnline && data.auto_enabled
            ? `A matching receipt and notification credit your wallet within moments${
                data.max_auto_amount_php
                  ? ` (up to ₱${Number(data.max_auto_amount_php).toLocaleString()} per request)`
                  : ""
              }. Anything unclear waits for the platform owner.`
            : "Automatic verification is not available right now, so every request is checked and released by the platform owner."}
        </span>
      </p>
    </div>
  );
}

/** Super Admin view: platform collection accounts and the (account-agnostic) listener health. */
export function PlatformListenerCoverageCard() {
  const data = useReadiness();
  if (!data) return null;
  const uncovered = data.methods.filter((m) => !m.listener_watching);
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Platform accounts vs listener coverage</CardTitle>
        <p className="text-sm text-muted-foreground">
          What members see on Universe → My Wallet → Cash In. Any registered platform phone captures
          notifications for all of these accounts — no per-account pairing. Automatic approval is{" "}
          {data.auto_enabled ? "on" : "off"}
          {data.require_listener_match ? " and requires a listener match" : ""}.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <MethodRows data={data} />
        {uncovered.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            No active platform listener phone is registered, so cash ins to{" "}
            {uncovered.map((m) => m.name).join(", ")} are always reviewed manually. Register a
            platform phone under “Payment notification listener” to enable automatic verification
            for every account at once.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
