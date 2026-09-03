/**
 * The WaveWallet explanation, shared by the public guide and the in-app
 * Guide & Help tab.
 *
 * Wording lives in the CMS tables (guide_sections / guide_faqs) so the platform
 * owner can correct it from the console without changing the public URL. Only
 * the always-true structural explanations live here.
 */
import {
  Coins,
  Gift,
  Network,
  RefreshCw,
  ShieldCheck,
  Ticket,
  Wallet,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import type { GuideContent } from "@/lib/guide.functions";

export const BASICS = [
  {
    icon: Coins,
    title: "Coins are your shop cashflow",
    body: "Coins are the internal value that circulates inside one shop. Your admin wallet holds them, resellers buy them from you, customers spend them on WiFi vouchers, and the value comes back to you as sales. The same Coins revolve again and again.",
  },
  {
    icon: Network,
    title: "Resellers and subresellers extend your reach",
    body: "Resellers get their own wallet and their own cashback rate. A subreseller sits under a reseller, and the subreseller share comes out of the reseller total. Whatever remains after those shares stays with you as shop earnings.",
  },
  {
    icon: Ticket,
    title: "WiFi vouchers are what customers buy",
    body: "You add your voucher products with prices and stock, and upload the codes from your hotspot controller. Customers pay with Coins, receive a code, and connect. Every sale is written to an immutable ledger.",
  },
  {
    icon: Wallet,
    title: "Cash In and Cash Out",
    body: "Customers top up their Coins by paying your shop, and payouts are settled by you or by the platform depending on the path. Coins themselves are never a payment instrument — they are shop cashflow.",
  },
  {
    icon: Gift,
    title: "Cashback and Points",
    body: "Cashback rewards the people who sell for you and is set per member. Points reward the customers who keep buying, and can be redeemed for rewards you define.",
  },
  {
    icon: RefreshCw,
    title: "The subscription is an expense, not the Coins",
    body: "Your monthly plan price is a business expense. The Coin allocation that comes with it is one-time revolving cashflow capacity — renewing keeps the shop running with the Coins you already have, and upgrading mints only the difference.",
  },
];

export function GuideBasics() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {BASICS.map((b) => (
        <Card key={b.title} className="shadow-[var(--shadow-card)]">
          <CardContent className="px-4">
            <b.icon className="size-5 text-primary" />
            <h3 className="mt-2 text-sm font-semibold tracking-tight">{b.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function GuideSections({ sections }: { sections: GuideContent["sections"] }) {
  if (sections.length === 0) return null;
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <article key={s.id}>
          <h3 className="text-base font-semibold tracking-tight">{s.heading}</h3>
          {s.subheading ? <p className="text-xs font-medium text-primary">{s.subheading}</p> : null}
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {s.body}
          </p>
        </article>
      ))}
    </div>
  );
}

export function GuidePlans({ plans }: { plans: GuideContent["plans"] }) {
  return (
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
              {Number(p.coin_allocation).toLocaleString()} Coins revolving shop cashflow capacity
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
  );
}

export function GuideFaqs({
  faqs,
  questions,
}: {
  faqs: GuideContent["faqs"];
  questions: GuideContent["questions"];
}) {
  if (faqs.length === 0 && questions.length === 0) return null;
  return (
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
          <AccordionContent className="text-sm">
            <div className="rounded-lg border border-success/40 bg-success/5 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-success">
                Answered by ONE WAVE Support
              </p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{q.answer}</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** A worked example, always labelled as a simulation. */
export function GuideExample() {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="px-4">
        <StatusBadge tone="brand">Example / simulation</StatusBadge>
        <p className="mt-2 text-sm font-semibold tracking-tight">
          How 1,000 Coins of capacity revolve
        </p>
        <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>1. Your admin wallet holds 1,000 Coins of shop cashflow capacity.</li>
          <li>2. You load 300 Coins to a reseller after they pay you for them.</li>
          <li>3. The reseller loads 100 Coins to a subreseller under them.</li>
          <li>
            4. A customer buys a ₱50 one-day WiFi voucher. With a 10% reseller rate and a 4%
            subreseller rate, the subreseller earns 2 Coins, the reseller earns 3 Coins, and the
            remaining 45 Coins stay with your shop.
          </li>
          <li>5. The same Coins are then sold again — that is the revolving part.</li>
        </ol>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          Illustrative figures only. Your own prices, cashback rates and volumes decide your actual
          results.
        </p>
      </CardContent>
    </Card>
  );
}
