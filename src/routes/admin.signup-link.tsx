import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, Link2, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { signupPath, signupUrl } from "@/lib/wavewallet-actions";

export const Route = createFileRoute("/admin/signup-link")({
  head: () => ({
    meta: [
      { title: "Customer Signup Link — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Share your ecosystem's unique customer signup link so new users join your shop automatically as customers.",
      },
      { property: "og:title", content: "Customer Signup Link — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Copy or share the tenant-specific signup URL for your hotspot shop.",
      },
    ],
  }),
  component: AdminSignupLink,
});

function AdminSignupLink() {
  const { ecosystem } = useSession("admin");
  const [copied, setCopied] = useState(false);
  if (!ecosystem) return null;

  const url = signupUrl(ecosystem.slug);
  const path = signupPath(ecosystem.slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Signup link copied");
    } catch {
      toast.error("Could not copy — select and copy the link manually.");
    }
  };

  const share = async () => {
    const data = {
      title: `Join ${ecosystem.name}`,
      text: `Create your ${ecosystem.name} account to buy WiFi vouchers, hold credits and earn points.`,
      url,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(data);
      } catch {
        /* user dismissed */
      }
    } else {
      await copy();
      toast("Sharing isn't available here — link copied instead.");
    }
  };

  return (
    <>
      <PageSection
        title="Customer signup link"
        description="Anyone who opens this link joins your ecosystem as a customer. Admin and reseller accounts are never created here."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="size-4 text-primary" />
                {ecosystem.name}
              </span>
              <StatusBadge tone="brand">{path}</StatusBadge>
            </div>
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={copy} className="flex-1">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button variant="secondary" onClick={share} className="flex-1">
                <Share2 className="size-4" />
                Share
              </Button>
              <Button variant="outline" asChild>
                <a href={path} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Open
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Post it on {ecosystem.facebookPageName || "your Facebook page"}, print it on receipts,
              or send it in chat. New signups appear instantly under Customers.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Signup page preview" description="What the customer sees when they open your link.">
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="surface-gradient px-5 py-6 text-primary-foreground">
              <p className="text-[10px] uppercase tracking-wide opacity-80">WaveWallet · Customer signup</p>
              <p className="mt-1.5 text-lg font-semibold">Join {ecosystem.name}</p>
              <p className="mt-1 text-xs opacity-90 line-clamp-2">{ecosystem.description}</p>
            </div>
            <div className="space-y-2.5 p-5">
              {["Full name", "Email", "Mobile number"].map((f) => (
                <div key={f} className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">{f}</p>
                  <div className="h-9 rounded-md border border-border bg-muted/40" />
                </div>
              ))}
              <div className="h-9 rounded-md bg-primary/90" />
              <p className="text-center text-[11px] text-muted-foreground">
                Creates a customer account in {ecosystem.name}
              </p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Later" description="Planned once Cloud is enabled.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="flex items-start gap-3">
            <QrCode className="mt-0.5 size-5 text-primary" />
            <p className="text-sm text-muted-foreground">
              Printable QR poster, per-reseller referral links and signup analytics will attach to
              this same tenant-scoped URL.
            </p>
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
