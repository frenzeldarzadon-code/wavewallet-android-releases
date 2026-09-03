import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRight, MailCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { signUpInvitedOperator } from "@/lib/auth";
import { platformSettings } from "@/lib/wavewallet";

export const Route = createFileRoute("/invite")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search["email"] === "string" ? (search["email"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Operator onboarding — ONE WAVE" },
      {
        name: "description",
        content:
          "Accept your WaveWallet operator invitation and set up the account for your assigned hotspot shop.",
      },
      { property: "og:title", content: "Operator onboarding — ONE WAVE" },
      {
        property: "og:description",
        content: "Invitation-only onboarding for hotspot operators running a WaveWallet shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { email: invitedEmail } = useSearch({ from: "/invite" });
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: invitedEmail,
    phone: "",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) {
      toast.error("Enter your full name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      toast.error("Enter the email address your invitation was sent to.");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Use a password with at least 8 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpInvitedOperator({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      if (needsEmailConfirmation) setSent(true);
      else {
        toast.success("Operator account created.");
        navigate({ to: "/admin" });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create the account.";
      toast.error(
        message.includes("invite link")
          ? "No pending invitation matches this email address."
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="surface-gradient px-6 py-10 text-primary-foreground">
        <div className="mx-auto max-w-md">
          <p className="text-xs uppercase tracking-wide opacity-80">
            {platformSettings.productName} · Operator onboarding
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight">Accept your invitation</h1>
          <p className="mt-2 text-sm opacity-90">
            Use the exact email address the platform owner invited. Your shop and operator role
            are assigned by the database — they can never be chosen here.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-md px-4 pb-12">
        {sent ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 py-8 text-center">
              <MailCheck className="mx-auto size-8 text-success" />
              <h2 className="text-lg font-semibold">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                We sent a confirmation link to <span className="font-medium">{form.email}</span>.
                Confirm it, then sign in to open your shop console.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/">Back to sign in</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Invitation required</span>
                <StatusBadge tone="brand">Operators only</StatusBadge>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iname">Full name</Label>
                <Input
                  id="iname"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iemail">Invited email</Label>
                <Input
                  id="iemail"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Email address"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iphone">Mobile number</Label>
                <Input
                  id="iphone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Mobile number"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ipass">Password</Label>
                <Input
                  id="ipass"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iconfirm">Confirm password</Label>
                <Input
                  id="iconfirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Repeat your password"
                />
              </div>
              <Button className="w-full" disabled={busy} onClick={submit}>
                {busy ? "Creating account…" : "Create operator account"}
                <ArrowRight className="size-4" />
              </Button>
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                If the email does not match a pending invitation, no operator role is granted — the
                signup is rejected by the database.
              </p>
            </CardContent>
          </Card>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already onboarded?{" "}
          <Link to="/" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
