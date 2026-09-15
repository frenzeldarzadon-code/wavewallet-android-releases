import { ArrowDown, ArrowUp, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/ui-kit";
import { fetchMyProfile, updateOwnProfile } from "@/lib/profile";
import { fetchSellerStorefront, orderedStorefrontSections } from "@/lib/seller-storefront";

type OrderItem = { key: string; label: string; kind: "Retail Shop" | "Voucher Shop" };

function savedOrder(preferences: unknown): string[] {
  const value = (preferences as { storefront_section_order?: unknown } | null)?.storefront_section_order;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function ProfileStorefrontOrderCard({ userId }: { userId: string }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await fetchMyProfile(userId);
      if (!profile?.handle) return;
      const store = await fetchSellerStorefront(profile.handle);
      const available = store
        ? orderedStorefrontSections(store).map((section) => ({
            key: section.key,
            label: section.shop.name,
            kind: section.kind === "retail" ? "Retail Shop" as const : "Voucher Shop" as const,
          }))
        : [];
      const preference = savedOrder(profile.preferences);
      const byKey = new Map(available.map((item) => [item.key, item]));
      const ordered = [
        ...preference.map((key) => byKey.get(key)).filter((item): item is OrderItem => Boolean(item)),
        ...available.filter((item) => !preference.includes(item.key)),
      ];
      setItems(ordered);
      setSaved(ordered.map((item) => item.key));
    } catch (error) {
      toast.error("Could not load Profile shop order", { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => void load(), [load]);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  const current = items.map((item) => item.key);
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      await updateOwnProfile({ preferences: { storefront_section_order: current } });
      setSaved(current);
      toast.success("Profile shop order saved");
    } catch (error) {
      toast.error("Could not save Profile shop order", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!loading && items.length < 2) return null;

  return (
    <PageSection title="Profile shop order" description="Choose how your shop sections appear to visitors on your Profile.">
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3 p-4 sm:p-5">
          {loading ? <p className="text-sm text-muted-foreground">Loading Profile shops…</p> : (
            <ol className="space-y-2">
              {items.map((item, index) => (
                <li key={item.key} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-bold">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.kind}</span>
                  </span>
                  <Button type="button" size="icon" variant="ghost" disabled={index === 0 || busy} aria-label={`Move ${item.label} up`} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                  <Button type="button" size="icon" variant="ghost" disabled={index === items.length - 1 || busy} aria-label={`Move ${item.label} down`} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
                </li>
              ))}
            </ol>
          )}
          <Button className="w-full sm:w-auto" disabled={loading || busy || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save Profile order
          </Button>
        </CardContent>
      </Card>
    </PageSection>
  );
}