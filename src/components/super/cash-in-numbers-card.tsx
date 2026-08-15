/**
 * Platform-owner view of the receiving GCash number of every shop.
 *
 * The number lives on the shop (`ecosystems.cash_in_gcash_number`) because a
 * cash in is always paid into one shop's account. Shop admins edit their own
 * on Admin → Settings; this card gives the platform owner the same field for
 * every shop in one place. Saving goes through `set_ecosystem_cash_in_number`,
 * which re-checks authorisation and validates the number server-side — nothing
 * here changes Cash In approval rules or turns automatic approval on.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhMobile, setShopCashInNumber } from "@/lib/cash-in-auto";

interface ShopRow {
  id: string;
  name: string;
  number: string;
}

export function CashInNumbersCard() {
  const [rows, setRows] = useState<ShopRow[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("ecosystems")
      .select("id, name, cash_in_gcash_number, archived_at")
      .order("name");
    if (error) {
      toast.error("Could not load shops", { description: error.message });
      setRows([]);
      return;
    }
    const list = (data ?? []) as Array<{
      id: string;
      name: string | null;
      cash_in_gcash_number: string | null;
      archived_at: string | null;
    }>;
    setRows(
      list
        .filter((s) => !s.archived_at)
        .map((s) => ({ id: s.id, name: s.name ?? "Shop", number: s.cash_in_gcash_number ?? "" })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: ShopRow) => {
    const trimmed = row.number.trim();
    if (trimmed !== "" && !normalizePhMobile(trimmed)) {
      toast.error("Enter a valid GCash number, for example 09171234567.");
      return;
    }
    setSavingId(row.id);
    try {
      await setShopCashInNumber(row.id, trimmed === "" ? null : trimmed);
      toast.success(
        trimmed === ""
          ? `${row.name}: receiving number cleared. Cash ins go to manual review.`
          : `${row.name}: receiving GCash number saved.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that number.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]" id="cash-in-receiving-numbers">
      <CardHeader>
        <CardTitle className="text-sm">Receiving GCash numbers (per shop)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          The number members must pay for a cash in. It belongs to the shop, so each shop has its own. 09XXXXXXXXX and
          +639XXXXXXXXX count as the same number. Leave blank to send every cash in of that shop to manual review.
        </p>
        {rows === null ? (
          <p className="text-xs text-muted-foreground">Loading shops…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active shops yet.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="space-y-1.5 border-t border-border pt-3 first:border-0 first:pt-0">
              <Label htmlFor={`gcash-${row.id}`}>{row.name}</Label>
              <div className="flex gap-2">
                <Input
                  id={`gcash-${row.id}`}
                  inputMode="tel"
                  placeholder="09171234567"
                  value={row.number}
                  onChange={(e) =>
                    setRows((prev) =>
                      (prev ?? []).map((r) => (r.id === row.id ? { ...r, number: e.target.value } : r)),
                    )
                  }
                />
                <Button size="sm" disabled={savingId === row.id} onClick={() => void save(row)}>
                  {savingId === row.id ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
