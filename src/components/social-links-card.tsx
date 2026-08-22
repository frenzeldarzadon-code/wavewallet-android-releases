import { ExternalLink, Eye, EyeOff, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import {
  EXTERNAL_LINK_PROPS,
  LABEL_MAX,
  MAX_LINKS,
  PLATFORMS,
  addLink,
  fetchMyLinks,
  platformLabel,
  prettyUrl,
  removeLink,
  updateLink,
  validateLabel,
  validateLink,
  type SocialLink,
  type SocialPlatform,
} from "@/lib/social-links";

/**
 * Optional social accounts on the signed-in member's own profile. Adding links
 * is never required, and each link is private until the member makes it public.
 */
export function SocialLinksCard({
  ecosystemId,
  userId,
}: {
  ecosystemId: string;
  userId: string;
}) {
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform>("facebook");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  const spec = PLATFORMS.find((p) => p.value === platform)!;

  const load = useCallback(async () => {
    try {
      setLinks(await fetchMyLinks(userId));
    } catch (e) {
      toast.error("Could not load your links", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const problem = validateLink(platform, url) ?? validateLabel(label);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (links.length >= MAX_LINKS) {
      toast.error(`You can keep up to ${MAX_LINKS} links`);
      return;
    }
    setBusy(true);
    try {
      await addLink({
        ecosystemId,
        userId,
        platform,
        url,
        label,
        isPublic,
        sortOrder: links.length,
      });
      setUrl("");
      setLabel("");
      toast.success("Link added");
      await load();
    } catch (e) {
      toast.error("Could not add that link", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (link: SocialLink) => {
    try {
      await updateLink(link.id, { isPublic: !link.is_public });
      setLinks((prev) =>
        prev.map((l) => (l.id === link.id ? { ...l, is_public: !l.is_public } : l)),
      );
    } catch (e) {
      toast.error("Could not update visibility", { description: (e as Error).message });
    }
  };

  const remove = async (link: SocialLink) => {
    try {
      await removeLink(link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      toast.success("Link removed");
    } catch (e) {
      toast.error("Could not remove that link", { description: (e as Error).message });
    }
  };

  return (
    <PageSection devSlot="social-links-card.social-accounts-optional"
      title="Social accounts (optional)"
      description="Add links to your pages if you want to. Nothing is required, and only the links you mark public are visible to other members of your shop."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your links…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have not added any social accounts. That is perfectly fine.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <Card key={l.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="flex items-center gap-3 py-3">
                <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {l.label || platformLabel(l.platform)}
                    </span>
                    <Badge variant={l.is_public ? "secondary" : "outline"}>
                      {l.is_public ? "Public" : "Private"}
                    </Badge>
                  </div>
                  <a
                    href={l.url}
                    {...EXTERNAL_LINK_PROPS}
                    className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {prettyUrl(l.url)} <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10"
                  onClick={() => void toggle(l)}
                  aria-label={l.is_public ? "Make this link private" : "Make this link public"}
                >
                  {l.is_public ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 text-destructive"
                  onClick={() => void remove(l)}
                  aria-label="Remove this link"
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {links.length < MAX_LINKS ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="linkPlatform">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as SocialPlatform)}>
                <SelectTrigger id="linkPlatform" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="linkLabel">Label (optional)</Label>
              <Input
                id="linkLabel"
                value={label}
                maxLength={LABEL_MAX}
                placeholder="My shop page"
                className="h-11"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="linkUrl">Web address</Label>
              <Input
                id="linkUrl"
                inputMode="url"
                autoComplete="url"
                value={url}
                placeholder={spec.placeholder}
                className="h-11"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 sm:col-span-2">
              <div>
                <Label htmlFor="linkPublic">Show this link to other members</Label>
                <p className="text-xs text-muted-foreground">
                  Private links stay visible to you only and never appear in member searches.
                </p>
              </div>
              <Switch id="linkPublic" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <div className="sm:col-span-2">
              <Button className="h-11" disabled={busy || !url.trim()} onClick={() => void add()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
                Add link
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageSection>
  );
}
