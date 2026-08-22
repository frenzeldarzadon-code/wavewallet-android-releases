import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, Link2, Power, RefreshCw, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/signup-link")({
  head: () => ({
    meta: [
      { title: "Customer Signup Link — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Share your shop's unique customer signup link so new users join your shop automatically as customers.",
      },
      { property: "og:title", content: "Customer Signup Link — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Copy, share, disable or rotate the tenant-specific signup URL for your hotspot shop.",
      },
    ],
  }),
  component: AdminSignupLink,
});

function AdminSignupLink() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [copied, setCopied] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!ecosystemDbId) return;
    const { data } = await supabase
      .from("ecosystems")
      .select("signup_enabled, signup_token")
      .eq("id", ecosystemDbId)
      .maybeSingle();
    if (data) {
      setEnabled(data.signup_enabled);
      setToken(data.signup_token);
    }
  }, [ecosystemDbId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ecosystem) return null;

  const path = `/join/${ecosystem.slug}`;
  const url = `${typeof window === "undefined" ? "https://wavewallet.app" : window.location.origin}${path}`;

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
      text: `Create your ${ecosystem.name} account to buy WiFi vouchers, hold coins and earn points.`,
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

  const toggle = async () => {
    if (!ecosystemDbId) return;
    setBusy(true);
    const next = !enabled;
    const { error } = await supabase
      .from("ecosystems")
      .update({ signup_enabled: next })
      .eq("id", ecosystemDbId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEnabled(next);
    toast.success(next ? "Signup link enabled" : "Signup link disabled");
  };

  const regenerate = async () => {
    if (!ecosystemDbId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("regenerate_signup_token", {
      _ecosystem_id: ecosystemDbId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setToken(data ?? "");
    toast.success("Link key rotated and audit-logged");
  };

  return (
    <>
      <PageSection devSlot="signup-link.customer-signup-link"
        title="Customer signup link"
        description="Anyone who opens this link joins your shop as a customer. Admin and reseller accounts are never created here."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Link2 className="size-4 text-primary" />
                {ecosystem.name}
              </span>
              <StatusBadge tone={enabled ? "success" : "danger"}>
                {enabled ? "Accepting signups" : "Disabled"}
              </StatusBadge>
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
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button variant={enabled ? "destructive" : "default"} size="sm" onClick={toggle} disabled={busy}>
                <Power className="size-4" />
                {enabled ? "Disable signups" : "Enable signups"}
              </Button>
              <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
                <RefreshCw className="size-4" />
                Rotate link key
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Disabling is enforced in the database — a disabled link stops resolving to your shop
              immediately, and the ecosystem itself stays intact. Current key:{" "}
              <span className="font-mono">{token.slice(0, 8) || "—"}…</span>
            </p>
          </CardContent>
        </Card>
      </PageSection>

    </>
  );
}
