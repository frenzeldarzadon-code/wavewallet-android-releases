/**
 * Receiving GCash number for a shop.
 *
 * This is the number members must have paid to. It is configured per shop by
 * the shop admin or the platform owner — never hard-coded — and the server
 * compares it (after normalising 09.../+639... formats) with the number the
 * member submits. Only authorised operators can read or change it.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchShopCashInNumber, normalizePhMobile, setShopCashInNumber } from "@/lib/cash-in-auto";

export function CashInNumberCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ecosystemId) return;
    void fetchShopCashInNumber(ecosystemId)
      .then((n) => setValue(n ?? ""))
      .catch(() => {});
  }, [ecosystemId]);

  if (!ecosystemId) return null;

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed !== "" && !normalizePhMobile(trimmed)) {
      toast.error("Enter a valid GCash number, for example 09171234567.");
      return;
    }
    setSaving(true);
    try {
      await setShopCashInNumber(ecosystemId, trimmed === "" ? null : trimmed);
      toast.success(
        trimmed === ""
          ? "Receiving number cleared. Cash ins will wait for manual review."
          : "Receiving GCash number saved.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that number.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Receiving GCash number</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="shop-gcash">Number members pay to</Label>
          <Input
            id="shop-gcash"
            inputMode="tel"
            placeholder="09171234567"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            A cash in can only be approved automatically when the member says they paid this number. 09XXXXXXXXX and
            +639XXXXXXXXX are treated as the same number. Leave it blank to send every cash in to manual review.
          </p>
        </div>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save number"}
        </Button>
      </CardContent>
    </Card>
  );
}
