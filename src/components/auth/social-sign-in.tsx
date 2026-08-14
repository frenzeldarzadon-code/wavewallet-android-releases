/**
 * Social sign-in buttons.
 *
 * Only providers that are actually configured in the auth environment are
 * clickable — an unconfigured provider renders disabled with the reason, so we
 * never advertise a login that cannot work.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PROVIDERS, signInWithProvider, type ProviderId } from "@/lib/auth-providers";

export function SocialSignIn({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState<ProviderId | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {PROVIDERS.map((p) => (
        <div key={p.id}>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!p.available || disabled || busy !== null}
            title={p.unavailableReason}
            onClick={async () => {
              setBusy(p.id);
              try {
                await signInWithProvider(p.id);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Sign-in failed.");
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue with {p.label}
          </Button>
          {p.available ? null : (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {p.unavailableReason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
