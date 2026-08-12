import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { writeSession } from "@/lib/session";
import { PermissionError, ecosystemBySlug, signUpCustomer } from "@/lib/wavewallet-actions";
import { platformSettings } from "@/lib/wavewallet";

export const Route = createFileRoute("/join/$slug")({
  head: () => ({
    meta: [
      { title: "Create your customer account — WaveWallet" },
      {
        name: "description",
        content:
          "Join your hotspot operator's WaveWallet shop to buy vouchers, hold credits, earn points and redeem rewards.",
      },
      { property: "og:title", content: "Create your customer account — WaveWallet" },
      {
        property: "og:description",
        content: "Sign up with your operator's link and start buying vouchers with credits or points.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { slug } = useParams({ from: "/join/$slug" });
  const navigate = useNavigate();
  const eco = ecosystemBySlug(slug);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);

  if (!eco) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3 py-8 text-center">
            <h1 className="text-lg font-semibold">Signup link not found</h1>
            <p className="text-sm text-muted-foreground">
              This shop link is invalid or no longer active. Ask your hotspot operator for their
              current signup link.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const submit = () => {
    setBusy(true);
    try {
      const account = signUpCustomer({ ecosystemSlug: slug, ...form });
      writeSession({ accountId: account.id });
      toast.success(`Welcome to ${eco.name}!`);
      navigate({ to: "/app" });
    } catch (e) {
      toast.error(e instanceof PermissionError ? e.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="surface-gradient px-6 py-10 text-primary-foreground">
        <div className="mx-auto max-w-md">
          <p className="text-xs uppercase tracking-wide opacity-80">
            {platformSettings.productName} · Customer signup
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight">Join {eco.name}</h1>
          <p className="mt-2 text-sm opacity-90">{eco.description}</p>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-md px-4 pb-12">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">You are joining</span>
              <StatusBadge tone="brand">{eco.name}</StatusBadge>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Juan Dela Cruz"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Mobile number</Label>
              <Input
                id="phone"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="0917 000 0000"
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={submit}>
              Create customer account
              <ArrowRight className="size-4" />
            </Button>
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Public signup always creates a customer account inside {eco.name}. Operator and
              platform accounts are never created here.
            </p>
          </CardContent>
        </Card>

        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Wallet className="size-4 text-primary" />
            What you get
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Credit wallet for buying vouchers instantly</li>
            <li>Points on qualifying spend, redeemable for rewards</li>
            <li>Full transaction history for every purchase and transfer</li>
          </ul>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
