import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  CircleHelp,
  Coins,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { loadGuide } from "@/lib/guide.functions";
import { peso } from "@/lib/wavewallet";

const TITLE = "How WaveWallet works — WiFi voucher shops, Coins and plans";
const DESCRIPTION =
  "Understand the WaveWallet ecosystem: Coins as revolving shop cashflow, resellers and cashback, WiFi voucher sales, and the subscription plans for hotspot operators.";

export const Route = createFileRoute("/guide")({
  loader: () => loadGuide(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <GuideShell>
      <p className="text-sm text-muted-foreground">
        The guide could not be loaded right now. Please refresh the page.
      </p>
    </GuideShell>
  ),
  notFoundComponent: () => (
    <GuideShell>
      <p className="text-sm text-muted-foreground">This guide page does not exist.</p>
    </GuideShell>
  ),
  component: GuidePage,
});

function GuideShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Link to="/" className="text-sm font-semibold tracking-tight text-primary">
          WaveWallet
        </Link>
        <Button asChild size="sm" variant="outline">
          <Link to="/">Sign in</Link>
        </Button>
      </div>
      {children}
    </main>
  );
}

const BASICS = [
  {
    icon: Coins,
    title: "Coins are your shop cashflow",
    body: "Coins are the internal value that circulates inside your shop. Your admin wallet holds them, resellers buy them from you, and customers spend them on WiFi vouchers. Coins revolve — the same value is used again and again as it moves between wallets.",
  },
  {
    icon: Users,
    title: "Resellers and subresellers extend your reach",
    body: "You can give resellers their own wallets and cashback rate. Subresellers sit under a reseller and their share comes out of the reseller's total. Whatever is left after those shares stays with you as shop earnings.",
  },
  {
    icon: Store,
    title: "WiFi vouchers are what customers buy",
    body: "You add your voucher products with their prices and stock. Customers pay with Coins, receive the voucher code, and connect to your hotspot. Every sale is recorded in an immutable ledger.",
  },
  {
    icon: RefreshCw,
    title: "The subscription is an expense, not the Coins",
    body: "Your monthly plan price is a business expense. The Coin allocation that comes with it is cashflow capacity — it is granted once when you activate, so renewing simply keeps your shop running with the Coins you already have.",
  },
];

function GuidePage() {
  const { sections, faqs, plans, questions } = Route.useLoaderData();
  const [question, setQuestion] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    try {
      const { error } = await supabase.rpc("submit_guide_question", {
        _question: question,
        ...(contact.trim() ? { _contact: contact.trim() } : {}),
      });
      if (error) throw new Error(error.message);
      setQuestion("");
      setContact("");
      toast.success("Thanks — WaveWallet Support will review your question.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your question");
    } finally {
      setSending(false);
    }
  };

  return (
    <GuideShell>
      <header className="mb-10">
        <StatusBadge tone="brand">Free to read — no account needed</StatusBadge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          How WaveWallet works for WiFi voucher shops
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          WaveWallet turns a hotspot business into a complete shop: Coins as revolving cashflow,
          resellers with their own wallets and cashback, WiFi voucher sales, points and rewards —
          all on one mobile-first platform.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/start-shop">
              Try a 5-day review shop <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href="#plans">See the plans</a>
          </Button>
        </div>
      </header>

      <section className="mb-10 grid gap-3 sm:grid-cols-2">
        {BASICS.map((b) => (
          <Card key={b.title} className="shadow-[var(--shadow-card)]">
            <CardContent className="px-4">
              <b.icon className="size-5 text-primary" />
              <h2 className="mt-2 text-sm font-semibold tracking-tight">{b.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      {sections.length > 0 ? (
        <section className="mb-10 space-y-5">
          {sections.map((s) => (
            <article key={s.id}>
              <h2 className="text-base font-semibold tracking-tight">{s.heading}</h2>
              {s.subheading ? (
                <p className="text-xs font-medium text-primary">{s.subheading}</p>
              ) : null}
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      <section id="plans" className="mb-10 scroll-mt-6">
        <h2 className="text-base font-semibold tracking-tight">Subscription plans</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Each plan includes a one-time Coin allocation that becomes your shop&apos;s revolving
          cashflow. Upgrading only mints the difference, and unused value from your current month is
          deducted from the first month of the new plan.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="px-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">{p.name}</h3>
                    <p className="text-xs text-muted-foreground">{p.tagline}</p>
                  </div>
                  {p.recommended ? <StatusBadge tone="brand">Popular</StatusBadge> : null}
                </div>
                <p className="mt-3 text-lg font-semibold">
                  {p.price_configurable && Number(p.monthly_price) === 0
                    ? "Custom pricing"
                    : `${peso(Number(p.monthly_price))}/mo`}
                </p>
                <p className="text-xs font-medium text-success">
                  {Number(p.coin_allocation).toLocaleString()} Coins allocation
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                {p.who_for ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Who it is for: </span>
                    {p.who_for}
                  </p>
                ) : null}
                {p.upgrade_hint ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">When to upgrade: </span>
                    {p.upgrade_hint}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-base font-semibold tracking-tight">Try before you subscribe</h2>
        <Card className="mt-3 shadow-[var(--shadow-card)]">
          <CardContent className="px-4">
            <Sparkles className="size-5 text-primary" />
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Create one review shop and explore the full experience for 5 days with 1,000 simulated
              Demo Coins. Demo Coins have no real value and never touch real balances. After 5 days
              the review shop freezes until you subscribe — your WaveWallet account always stays
              yours.
            </p>
            <Button asChild className="mt-3" size="sm">
              <Link to="/start-shop">Create a review shop</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {faqs.length > 0 || questions.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-2 text-base font-semibold tracking-tight">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="rounded-xl border px-3">
            {faqs.map((f) => (
              <AccordionItem key={f.id} value={f.id}>
                <AccordionTrigger className="text-left text-sm">{f.question}</AccordionTrigger>
                <AccordionContent className="whitespace-pre-line text-sm text-muted-foreground">
                  {f.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
            {questions.map((q) => (
              <AccordionItem key={q.id} value={q.id}>
                <AccordionTrigger className="text-left text-sm">{q.question}</AccordionTrigger>
                <AccordionContent className="whitespace-pre-line text-sm text-muted-foreground">
                  {q.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ) : null}

      <section className="mb-12">
        <h2 className="text-base font-semibold tracking-tight">Ask a question</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          WaveWallet Support answers questions here. Published answers help the next operator too.
        </p>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3 px-4">
            <div className="space-y-1.5">
              <Label htmlFor="guide-question">Your question</Label>
              <Textarea
                id="guide-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="For example: how do Coins move between my resellers and customers?"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guide-contact">Contact (optional)</Label>
              <Input
                id="guide-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Email or mobile number"
              />
            </div>
            <Button
              size="sm"
              onClick={submit}
              disabled={sending || question.trim().length < 10}
              className="w-full sm:w-auto"
            >
              <CircleHelp className="mr-1 size-4" /> Send question
            </Button>
          </CardContent>
        </Card>
      </section>

      <footer className="flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-success" />
        Coins are shop cashflow, not a payment instrument. Every movement is recorded in an
        immutable ledger.
      </footer>
    </GuideShell>
  );
}
