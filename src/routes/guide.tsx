/**
 * Public WaveWallet guide — the only anonymous experience.
 *
 * Marketing plus education: no wallet, GCash, subscription or financial action
 * can be reached from here. Copy that changes over time lives in the CMS tables
 * so the same shareable URL always shows the current content.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  CircleHelp,
  Coins,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InstallAppCard } from "@/components/install-app-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui-kit";
import {
  GuideBasics,
  GuideExample,
  GuideFaqs,
  GuidePlans,
  GuideSections,
} from "@/components/guide-body";
import { supabase } from "@/integrations/supabase/client";
import { loadGuide } from "@/lib/guide.functions";
import logo from "@/assets/wavewallet-logo.webp";
import hero from "@/assets/guide-hero.jpg";

const SITE = "https://wallet.sagadawave.com";
const URL = `${SITE}/guide`;
const OG_IMAGE = `${SITE}/og-wavewallet.jpg`;
const TITLE = "WaveWallet — run a WiFi voucher shop with Coins, resellers and rewards";
const DESCRIPTION =
  "WaveWallet turns your hotspot into a complete shop: Coins as revolving cashflow, resellers and subresellers with cashback, WiFi voucher sales, points and rewards. Plans from ₱50/month.";

export const Route = createFileRoute("/guide")({
  loader: () => loadGuide(),
  head: ({ loaderData }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { property: "og:site_name", content: "WaveWallet" },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: (loaderData?.faqs ?? []).slice(0, 10).map((f) => ({
            "@type": "Question",
            name: f.question,
            acceptedAnswer: { "@type": "Answer", text: f.answer },
          })),
        }),
      },
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

function Brand() {
  return (
    <Link to="/guide" className="flex items-center gap-2">
      <img src={logo} alt="WaveWallet" width={32} height={32} className="size-8" />
      <span className="text-sm font-semibold tracking-tight">WaveWallet</span>
    </Link>
  );
}

function GuideShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/start-shop">Create your shop</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" />
            Coins are shop cashflow, not a payment instrument. Every movement is recorded in an
            immutable ledger.
          </span>
          <span>© {new Date().getFullYear()} WaveWallet</span>
        </div>
      </footer>
    </div>
  );
}

const PILLARS = [
  { icon: Ticket, label: "WiFi vouchers" },
  { icon: RefreshCw, label: "Revolving cashflow" },
  { icon: Network, label: "Resellers & subresellers" },
  { icon: Coins, label: "Cashback & points" },
];

function GuidePage() {
  const { sections, faqs, plans, questions } = Route.useLoaderData();
  const [question, setQuestion] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (website.trim()) return; // bot
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
      <section className="mb-12 grid items-center gap-6 md:grid-cols-2">
        <div>
          <StatusBadge tone="brand">For hotspot operators · no account needed to read</StatusBadge>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Run your WiFi voucher business like a real shop
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            WaveWallet gives your hotspot a wallet, a reseller network and a voucher store on one
            mobile-first platform. Coins circulate as your shop&apos;s cashflow, resellers earn
            cashback, customers earn points, and every movement is recorded.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link to="/start-shop">
                Create your shop <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#plans">See the plans</a>
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {PILLARS.map((p) => (
              <span
                key={p.label}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              >
                <p.icon className="size-3.5 text-primary" /> {p.label}
              </span>
            ))}
          </div>
        </div>
        <img
          src={hero}
          alt="A WaveWallet shop wallet, WiFi vouchers and a reseller network"
          width={1600}
          height={912}
          className="w-full rounded-2xl border shadow-[var(--shadow-card)]"
        />
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">How the ecosystem works</h2>
        <GuideBasics />
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">See the money move</h2>
        <GuideExample />
      </section>

      {sections.length > 0 ? (
        <section className="mb-12">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">In detail</h2>
          <GuideSections sections={sections} />
        </section>
      ) : null}

      <section id="plans" className="mb-12 scroll-mt-20">
        <h2 className="text-lg font-semibold tracking-tight">Subscription plans</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The monthly price is your subscription. The Coin allocation is revolving shop cashflow
          capacity granted once when your plan is activated — it is not cash and cannot be
          withdrawn. Upgrading mints only the difference, and the unused value of your current month
          is deducted from the first month of the new plan.
        </p>
        <GuidePlans plans={plans} />
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Legacy shops and Subscription shops
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="px-4">
              <h3 className="text-sm font-semibold tracking-tight">Subscription shops</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                New shops run on a monthly plan with a one-time Coin allocation. Coins stay inside
                the shop: there are no cross-shop Coin transfers, and every wallet, member and
                ledger entry is isolated from every other shop.
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="px-4">
              <h3 className="text-sm font-semibold tracking-tight">Legacy shops</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Shops that joined before the plans keep their existing arrangement and behaviour
                unchanged. The Coin, cashback, points and voucher logic is the same across both.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold tracking-tight">Try it for 5 days</h2>
        <Card className="mt-3 shadow-[var(--shadow-card)]">
          <CardContent className="px-4">
            <Sparkles className="size-5 text-primary" />
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Sign up for a free WaveWallet account and create one review shop. For 5 days you can
              explore the whole flow — loading resellers, selling WiFi vouchers, cashback and points
              — using 1,000 simulated <strong>Demo Coins</strong>. Demo Coins have no monetary
              value, never touch real balances, and are removed when your shop goes live. Your
              account and shop always stay yours.
            </p>
            <Button asChild className="mt-3">
              <Link to="/start-shop">Sign up and create your shop</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section id="install" className="mb-12 scroll-mt-20">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Get the app</h2>
        <Card className="mb-3 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">
                WaveWallet for Android — official app
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Install the official WaveWallet Android app directly from this site. No Play Store
                needed. iPhone and iPad users can add the web app to the Home Screen instead.
              </p>
            </div>
            <Button asChild>
              <Link to="/download">Download the app</Link>
            </Button>
          </CardContent>
        </Card>
        <InstallAppCard className="shadow-[var(--shadow-card)]" />
      </section>

      <section className="mb-12">
        <h2 className="mb-2 text-lg font-semibold tracking-tight">
          Frequently asked questions
        </h2>
        <GuideFaqs faqs={faqs} questions={questions} />
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold tracking-tight">Ask a question</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          WaveWallet Support reviews and answers questions here. Published answers help the next
          operator too.
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
                maxLength={1000}
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
            <div aria-hidden className="hidden">
              <label htmlFor="guide-website">Leave this empty</label>
              <input
                id="guide-website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
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
            <p className="text-[11px] text-muted-foreground">
              Please ask without links. Questions are reviewed before they appear.
            </p>
          </CardContent>
        </Card>
      </section>
    </GuideShell>
  );
}
