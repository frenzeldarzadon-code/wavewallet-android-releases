/**
 * Chooses WHICH shop wallet a platform credit issuance lands in.
 *
 * Wallets never merge across shops, so when a member belongs to more than one
 * shop the operator must name the destination explicitly. With a single shop
 * the choice is made for them and simply displayed. The database re-checks the
 * membership regardless of what the client sends.
 */
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { fetchMemberShopWallets, type MemberShopWallet } from "@/lib/credit-management";

export function ShopWalletSelect({
  userId,
  value,
  onChange,
  onRequired,
  id = "issuance-shop",
}: {
  userId: string | null;
  value: string | null;
  onChange: (ecosystemId: string | null, wallet: MemberShopWallet | null) => void;
  /** True while the member has several shops and none is chosen yet. */
  onRequired?: (required: boolean) => void;
  id?: string;
}) {
  const [wallets, setWallets] = useState<MemberShopWallet[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    if (!userId) {
      setWallets([]);
      onChange(null, null);
      onRequired?.(false);
      return;
    }
    setLoading(true);
    void fetchMemberShopWallets(userId).then((rows) => {
      if (!live) return;
      setWallets(rows);
      setLoading(false);
      const first = rows[0] ?? null;
      onChange(rows.length === 1 ? (first?.ecosystemId ?? null) : null, rows.length === 1 ? first : null);
      onRequired?.(rows.length > 1);
    });
    return () => {
      live = false;
    };
    // onChange is a fresh closure each render; the target account is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) return null;

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading shop wallets…</p>;
  }

  if (wallets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This member belongs to no shop yet — credits go to their Universe wallet.
      </p>
    );
  }

  if (wallets.length === 1) {
    const only = wallets[0]!;
    return (
      <p className="text-xs text-muted-foreground">
        Credits land in the <span className="font-medium text-foreground">{only.ecosystemName}</span>{" "}
        wallet (currently {only.balance.toLocaleString()} credits).
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Shop wallet to credit</Label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => {
          const next = e.target.value || null;
          onChange(next, wallets.find((w) => w.ecosystemId === next) ?? null);
          onRequired?.(!next);
        }}
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select a shop…</option>
        {wallets.map((w) => (
          <option key={w.ecosystemId} value={w.ecosystemId}>
            {w.ecosystemName} · {w.balance.toLocaleString()} credits
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        This member has a separate wallet in each shop. Credits never move between them.
      </p>
    </div>
  );
}
