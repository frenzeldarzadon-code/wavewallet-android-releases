import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/auth";
import { supportContact } from "@/lib/credit-purchases";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — WaveWallet" },
      {
        name: "description",
        content:
          "Request a WaveWallet password reset link or set a new password after following the emailed recovery link.",
      },
      { property: "og:title", content: "Reset your password — WaveWallet" },
      {
        property: "og:description",
        content: "Request a reset link or choose a new WaveWallet password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Accounts registered with a mobile number only cannot receive email, so the
  // official support page (configured by the platform owner) is shown instead.
  const [support, setSupport] = useState<{ label: string; href: string; message: string } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    supabase.rpc("public_support_contact").then(({ data }) => {
      if (!active) return;
      setSupport(supportContact((data as Record<string, string>[] | null)?.[0] ?? null));
    });
    return () => {
      active = false;
    };
  }, []);

  // A recovery link lands here with a `type=recovery` hash that Supabase turns
  // into a short-lived session; only then do we show the "new password" form.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) {
      setRecovery(true);
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const sendLink = async () => {
    if (busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
      setSent(true);
      toast.success("If that email has an account, a reset link is on its way.");
    } catch (e) {
      toast.error(friendlyAuthError(e instanceof Error ? e.message : "Could not send the link."));
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (busy) return;
    if (password.length < 8) {
      toast.error("Use a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      toast.success("Password updated. Please sign in again.");
      await supabase.auth.signOut();
      navigate({ to: "/", replace: true });
    } catch (e) {
      toast.error(friendlyAuthError(e instanceof Error ? e.message : "Could not update password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">
            {recovery ? "Choose a new password" : "Reset your password"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {recovery
            ? "Set a new password for your account, then sign in again."
            : "We'll email you a secure link to set a new password."}
        </p>

        <Card className="mt-5 shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            {recovery ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && savePassword()}
                    placeholder="Repeat the password"
                  />
                </div>
                <Button className="w-full" onClick={savePassword} disabled={busy}>
                  {busy ? "Saving…" : "Update password"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendLink()}
                    placeholder="you@example.com"
                  />
                </div>
                <Button className="w-full" onClick={sendLink} disabled={busy || sent}>
                  {busy ? "Sending…" : sent ? "Link sent" : "Send reset link"}
                </Button>
              </>
            )}
            {recovery ? null : (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs font-semibold">No email on your account?</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  If you registered with a mobile number only, we cannot email you a reset link.
                  {support ? " Message the official support page for help:" : " Contact your shop operator for help."}
                </p>
                {support ? (
                  <a
                    className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                    href={support.href}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {support.label}
                  </a>
                ) : null}
                {support?.message ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">{support.message}</p>
                ) : null}
              </div>
            )}
            <p className="text-center text-xs">
              <Link to="/" className="text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
