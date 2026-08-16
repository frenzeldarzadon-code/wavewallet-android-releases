/**
 * Guide & Help inside the app: the same explanation as the public guide, always
 * available to a signed-in member whether their shop is in review or live.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageSection } from "@/components/ui-kit";
import {
  GuideBasics,
  GuideExample,
  GuideFaqs,
  GuidePlans,
  GuideSections,
} from "@/components/guide-body";
import { useHelpVisible } from "@/components/help-tip";
import { InstallAppCard } from "@/components/install-app-card";
import { loadGuide } from "@/lib/guide.functions";

const TITLE = "Guide & Help — WaveWallet";
const DESCRIPTION =
  "The complete WaveWallet guide for shop owners: Coins, resellers, WiFi vouchers, cashback, points, cash in and cash out, and the subscription plans.";

export const Route = createFileRoute("/help")({
  loader: () => loadGuide(),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm text-muted-foreground">
        The guide could not be loaded right now. Please refresh the page.
      </p>
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm text-muted-foreground">This page does not exist.</p>
    </main>
  ),
  component: HelpPage,
});

function HelpPage() {
  const { sections, faqs, plans, questions } = Route.useLoaderData();
  const [helpVisible, setHelpVisible] = useHelpVisible();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <BookOpen className="size-5 text-primary" /> Guide &amp; Help
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything about how WaveWallet works, from Coins to cashback. Come back here any time.
        </p>
      </header>

      <Card className="mb-6 shadow-[var(--shadow-card)]">
        <CardContent className="flex items-center justify-between gap-4 px-4">
          <div>
            <Label htmlFor="help-toggle" className="text-sm font-medium">
              Show contextual help
            </Label>
            <p className="text-xs text-muted-foreground">
              Shows the small (i) explanations next to features. Hiding them never removes this
              Guide tab.
            </p>
          </div>
          <Switch id="help-toggle" checked={helpVisible} onCheckedChange={setHelpVisible} />
        </CardContent>
      </Card>

      <PageSection title="The basics">
        <GuideBasics />
      </PageSection>

      <PageSection title="A worked example">
        <GuideExample />
      </PageSection>

      {sections.length > 0 ? (
        <PageSection title="In detail">
          <GuideSections sections={sections} />
        </PageSection>
      ) : null}

      <PageSection
        title="Subscription plans"
        description="The Coin allocation is granted once. Upgrading mints only the difference, and the unused value of your current month is deducted from the first month of the new plan."
      >
        <GuidePlans plans={plans} />
      </PageSection>

      <PageSection title="Install the app">
        <Card className="mb-3 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
            <div>
              <p className="text-sm font-medium">WaveWallet for Android — official app</p>
              <p className="text-xs text-muted-foreground">
                Download the official APK straight from WaveWallet. On iPhone or iPad, keep using
                the web app.
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/download">Get the app</Link>
            </Button>
          </CardContent>
        </Card>
        <InstallAppCard className="shadow-[var(--shadow-card)]" />
      </PageSection>

      <PageSection title="Frequently asked questions">
        <GuideFaqs faqs={faqs} questions={questions} />
      </PageSection>

      <div className="mt-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/guide">
            Open the public guide <ExternalLink className="ml-1 size-4" />
          </Link>
        </Button>
      </div>
    </main>
  );
}
