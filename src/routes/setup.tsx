import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MailCheck, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { createInitialSuperAdmin, superAdminSetupAvailable } from "@/lib/bootstrap.functions";
import { friendlyAuthError } from "@/lib/auth";
import { platformSettings } from "@/lib/wavewallet";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Initial Super Admin Setup — WaveWallet" },
      {
        name: "description",
        content:
          "One-time secure setup of the first WaveWallet platform owner account. Available only until a real Super Admin exists.",
      },
      { property: "og:title", content: "Initial Super Admin Setup — WaveWallet" },
      {
        property: "og:description",
        content: "One-time secure setup of the first WaveWallet platform owner account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "open" | "closed">("checking");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; needsConfirm: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    superAdminSetupAvailable()
      .then((r) => active && setState(r.available ? "open" : "closed"))
      .catch(() => active && setState("closed"));
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    if (form.name.trim().length < 2) {
      toast.error("Enter your full name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Use a password of at least 8 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await createInitialSuperAdmin({
        data: { fullName: form.name, email: form.email, password: form.password },
      });
      setDone({ email: res.email, needsConfirm: res.needsEmailConfirmation });
      if (!res.needsEmailConfirmation) toast.success("Platform owner account created.");
    } catch (e) {
      toast.error(friendlyAuthError(e instanceof Error ? e.message : "Setup failed."));
      const r = await superAdminSetupAvailable().catch(() => ({ available: false }));
      if (!r.available) setState("closed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">Initial Super Admin Setup</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          One-time setup of the {platformSettings.productName} platform owner. This page closes
          permanently once a real Super Admin exists.
        </p>

        {state === "checking" ? (
          <Card className="mt-5">
            <CardContent className="py-6 text-sm text-muted-foreground">Checking setup status…</CardContent>
          </Card>
        ) : null}

        {state === "closed" ? (
          <Card className="mt-5">
            <CardContent className="space-y-3 py-6">
              <StatusBadge tone="danger">Setup closed</StatusBadge>
              <p className="text-sm text-muted-foreground">
                A production Super Admin already exists for this platform. Sign in instead — there is
                no public way to create another owner account.
              </p>
              <Button variant="outline" onClick={() => navigate({ to: "/" })}>
                Back to sign in
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {state === "open" && done ? (
          <Card className="mt-5">
            <CardContent className="space-y-3 py-6">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <MailCheck className="size-4 text-success" /> Owner account created
              </p>
              {done.needsConfirm ? (
                <p className="text-sm text-muted-foreground">
                  Confirm your email first: we sent a verification link to{" "}
                  <span className="font-medium">{done.email}</span>. Click it, then sign in with your
                  email and password. Your Super Admin role is already reserved for this address.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You can sign in now with <span className="font-medium">{done.email}</span> and the
                  password you chose.
                </p>
              )}
              <Button onClick={() => navigate({ to: "/" })}>Go to sign in</Button>
            </CardContent>
          </Card>
        ) : null}

        {state === "open" && !done ? (
          <Card className="mt-5 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="owner@yourdomain.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Repeat the password"
                />
              </div>
              <Button className="w-full" onClick={submit} disabled={busy}>
                {busy ? "Creating owner account…" : "Create Super Admin"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                The account is created through normal email/password authentication. The Super Admin
                role is granted by the server — never chosen in the browser — and only once.
              </p>
              <p className="text-center text-xs">
                <Link to="/" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
