/**
 * Connected logins for the one global identity.
 *
 * Shows every sign-in method attached to this WaveWallet account. Unlinking is
 * refused whenever it would leave the account with no way to sign in, and
 * providers that are not configured in the auth environment are disabled with
 * an explanation instead of failing at click time.
 */
import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import {
  PROVIDERS,
  fetchLinkedIdentities,
  identityLabel,
  linkProvider,
  unlinkBlockedReason,
  unlinkProvider,
  type LinkedIdentity,
} from "@/lib/auth-providers";

export function ConnectedLoginsCard() {
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIdentities(await fetchLinkedIdentities());
    } catch {
      setIdentities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = (provider: string) => identities.find((i) => i.provider === provider) ?? null;

  return (
    <PageSection
      title="Connected logins"
      description="Ways you can sign in to this WaveWallet account. One person, one account — connecting a social login never creates a second identity."
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your sign-in methods…
        </p>
      ) : (
        <div className="space-y-2">
          {identities
            .filter((i) => i.provider === "email")
            .map((i) => (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <ShieldCheck className="size-5 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{identityLabel(i.provider)}</p>
                  <p className="truncate text-xs text-muted-foreground">{i.email ?? "Connected"}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground">Primary</span>
              </div>
            ))}

          {PROVIDERS.map((p) => {
            const link = connected(p.id);
            const blocked = link ? unlinkBlockedReason(identities, p.id) : null;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <Link2 className="size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{p.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {link
                      ? (link.email ?? "Connected")
                      : p.available
                        ? "Not connected"
                        : p.unavailableReason}
                  </p>
                </div>
                {link ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(blocked) || busy === p.id}
                    title={blocked ?? undefined}
                    onClick={async () => {
                      setBusy(p.id);
                      try {
                        await unlinkProvider(link);
                        toast.success(`${p.label} disconnected.`);
                        await load();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not disconnect.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Unlink className="size-4" /> Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!p.available || busy === p.id}
                    onClick={async () => {
                      setBusy(p.id);
                      try {
                        await linkProvider(p.id);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not connect.");
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : null} Connect
                  </Button>
                )}
              </div>
            );
          })}
          {blockedNote(identities)}
        </div>
      )}
    </PageSection>
  );
}

function blockedNote(identities: LinkedIdentity[]) {
  if (identities.length > 1) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Connect a second sign-in method before removing your current one — an account must always
      keep at least one usable login.
    </p>
  );
}
