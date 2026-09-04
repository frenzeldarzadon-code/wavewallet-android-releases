/**
 * Detected notification sources.
 *
 * The listener phone reads EVERY notification and reports its source (app
 * package, app name, channel/category) before anything is classified as a
 * payment. This card lists each source the phones have seen, how it was
 * treated, and lets the owner Block / Unblock it with one tap. Blocking reuses
 * the existing source rules: from the next notification on, the app is
 * filtered on arrival, nothing beyond its identity is stored and it can never
 * enter payment matching. Every change is written to the audit log.
 *
 * No notification content is shown here — only source identity and counts.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, EmptyState } from "@/components/ui-kit";
import { providerName } from "@/lib/payment-providers";
import {
  blockListenerSource,
  fetchListenerDetectedSources,
  unblockListenerSource,
  type ListenerDetectedSource,
} from "@/lib/listener-devices";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function ListenerDetectedSourcesCard({
  ecosystemId = null,
  ecosystemName,
}: {
  /** Shop admin view: sources seen by this shop's phones. Null = platform phones. */
  ecosystemId?: string | null;
  ecosystemName?: string | null;
} = {}) {
  const [sources, setSources] = useState<ListenerDetectedSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setSources(await fetchListenerDetectedSources(ecosystemId));
    } catch {
      setSources([]);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecosystemId]);

  const toggle = async (s: ListenerDetectedSource) => {
    setBusy(s.package_name);
    try {
      if (s.effective_mode === "deny") {
        const result = await unblockListenerSource(s.package_name, ecosystemId);
        toast.success(`${s.app_label ?? s.package_name} re-enabled`, {
          description:
            result === "allowed_explicitly"
              ? "A wider rule still blocked it, so an explicit Enabled rule was saved."
              : "The default (read) applies again.",
        });
      } else {
        await blockListenerSource(s.package_name, ecosystemId, "Blocked from detected sources");
        toast.success(`${s.app_label ?? s.package_name} blocked`, {
          description: "From the next notification on, nothing from this app is read or matched.",
        });
      }
      await load();
    } catch (error) {
      toast.error("Could not update this source", { description: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const reading = sources.filter((s) => s.effective_mode === "allow");
  const blocked = sources.filter((s) => s.effective_mode === "deny");

  return (
    <Card id="detected-sources" className="shadow-[var(--shadow-card)] scroll-mt-24">
      <CardHeader>
        <CardTitle>Detected notification sources</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every notification that reaches{" "}
          {ecosystemId ? `${ecosystemName ?? "this shop"}'s listener phones` : "the platform listener phones"}{" "}
          is first identified by its source app, then classified. Recognised payment apps go on to
          receipt matching; everything else is kept as “not a payment” so you can decide here
          whether to keep reading it or block it.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <StatusBadge tone="success">{reading.length} being read</StatusBadge>
          <StatusBadge tone="danger">{blocked.length} blocked</StatusBadge>
        </div>
      </CardHeader>
      <CardContent>
        {!loaded ? null : sources.length === 0 ? (
          <EmptyState
            title="No notifications seen yet"
            description="As soon as a paired phone forwards notifications, each source app appears here with a Block option."
          />
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => {
              const isBlocked = s.effective_mode === "deny";
              return (
                <li
                  key={s.package_name}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{s.app_label ?? s.package_name}</span>
                      {s.provider_id ? (
                        <StatusBadge tone="brand">{providerName(s.provider_id)} · payment app</StatusBadge>
                      ) : (
                        <StatusBadge tone="muted">not a payment app</StatusBadge>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{s.package_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.total} seen · {s.payments} payments · {s.non_payment} other
                      {s.unparsed ? ` · ${s.unparsed} unreadable` : ""}
                      {s.blocked_count ? ` · ${s.blocked_count} blocked` : ""} · last {ago(s.last_seen_at)}
                      {s.channel_id ? ` · channel ${s.channel_id}` : ""}
                      {s.category ? ` · ${s.category}` : ""}
                    </p>
                    {s.rule_mode ? (
                      <p className="text-xs text-muted-foreground">
                        {s.rule_mode === "deny" ? "Blocked" : "Enabled"}
                        {s.rule_by ? ` by ${s.rule_by}` : ""} {ago(s.rule_updated_at)}
                      </p>
                    ) : isBlocked ? (
                      <p className="text-xs text-muted-foreground">Blocked by a wider rule</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={isBlocked ? "danger" : "success"}>
                      {isBlocked ? "Blocked" : "Reading"}
                    </StatusBadge>
                    <Button
                      size="sm"
                      variant={isBlocked ? "outline" : "destructive"}
                      disabled={busy === s.package_name}
                      onClick={() => toggle(s)}
                    >
                      {isBlocked ? "Unblock" : "Block"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
