import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowRight, MailCheck, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AddressFields,
  EMPTY_ADDRESS,
  type AddressValue,
} from "@/components/universe/address-fields";
import { addressIssue } from "@/lib/ph-address";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { fetchSignupEcosystem, signUpCustomerAccount, type SignupEcosystem } from "@/lib/auth";
import { platformSettings } from "@/lib/wavewallet";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/join/$slug")({
  head: () => ({
    meta: [
      { title: "Create your customer account — WaveWallet" },
      {
        name: "description",
        content:
          "Join your hotspot operator's WaveWallet shop to buy vouchers, hold coins, earn points and redeem rewards.",
      },
      { property: "og:title", content: "Create your customer account — WaveWallet" },
      {
        property: "og:description",
        content: "Sign up with your operator's link and start buying vouchers with coins or points.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { slug } = useParams({ from: "/join/$slug" });
  const [eco, setEco] = useState<SignupEcosystem | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSignupEcosystem(slug).then((e) => {
      if (!active) return;
      setEco(e);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading shop…</p>
      </main>
    );
  }

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

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) {
      toast.error("Enter your full name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      toast.error("Enter a valid email address.");
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
    const addressProblem = addressIssue({
      province: address.province,
      cityMunicipality: address.cityMunicipality,
      barangay: address.barangay,
      street: address.street,
      houseNumber: address.houseNumber,
    });
    if (addressProblem) {
      toast.error(addressProblem);
      return;
    }
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpCustomerAccount({
        ecosystemSlug: slug,
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        province: address.province,
        cityMunicipality: address.cityMunicipality,
        barangay: address.barangay,
        street: address.street,
        houseNumber: address.houseNumber,
      });
      // Joining is automatic: the database activates the membership right away
      // (unless it holds the join back because the person already has coins in
      // this shop). Only an unconfirmed email still blocks direct entry.
      if (needsEmailConfirmation) {
        await supabase.auth.signOut();
        setNeedsEmail(true);
        setSent(true);
      } else {
        toast.success(`Welcome to ${eco.name}!`);
        await navigate({ to: "/app" });
      }

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create your account.");
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
        {sent ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 py-8 text-center">
              <MailCheck className="mx-auto size-8 text-success" />
              <h2 className="text-lg font-semibold">Application received</h2>
              <p className="text-sm text-muted-foreground">
                Your account is pending approval. You can enter the ecosystem after an authorized
                member of {eco.name} approves your application.
                {needsEmail
                  ? " We also sent a confirmation link to your email — please confirm it."
                  : ""}
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
              <div className="space-y-1.5">
                <AddressFields value={address} onChange={setAddress} idPrefix="join" />
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
                  placeholder="Repeat your password"
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </div>

              <Button className="w-full" disabled={busy} onClick={submit}>
                {busy ? "Creating account…" : "Create customer account"}
                <ArrowRight className="size-4" />
              </Button>
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Public signup always creates a customer account inside {eco.name}. The role and
                ecosystem are assigned by the database — operator and platform accounts are never
                created here.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Wallet className="size-4 text-primary" />
            What you get
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Coin wallet for buying vouchers instantly</li>
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
