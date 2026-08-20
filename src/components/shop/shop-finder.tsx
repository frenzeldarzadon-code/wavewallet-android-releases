/**
 * Find one shop — by its 7-digit Shop ID, or by picking the municipality the
 * operator works in.
 *
 * This is a convenience finder, never a public shop directory: the backend only
 * returns a shop name, its general location and its Shop ID, and membership is
 * still granted by the normal join operation afterwards.
 */
import { Loader2, MapPin, Search, Store } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchDiscoveryMunicipalities,
  fetchShopsInMunicipality,
  findShopByCode,
  isCompleteShopCode,
  normalizeShopCode,
  shopCodeIssue,
  type MunicipalityOption,
  type ShopSummary,
} from "@/lib/shop-directory";

interface Props {
  /** Called whenever a shop is confirmed (or cleared). */
  value: ShopSummary | null;
  onChange: (shop: ShopSummary | null) => void;
  /** Pre-filled Shop ID from a direct shop link. */
  initialCode?: string;
  idPrefix?: string;
}

export function ShopFinder({ value, onChange, initialCode, idPrefix = "shop" }: Props) {
  const [code, setCode] = useState(normalizeShopCode(initialCode ?? ""));
  const [looking, setLooking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [towns, setTowns] = useState<MunicipalityOption[]>([]);
  const [townQuery, setTownQuery] = useState("");
  const [town, setTown] = useState<MunicipalityOption | null>(null);
  const [operators, setOperators] = useState<ShopSummary[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);

  const issue = code ? shopCodeIssue(code) : null;

  // Resolve the Shop ID as soon as all seven digits are there.
  useEffect(() => {
    let active = true;
    if (!isCompleteShopCode(code)) {
      setNotFound(false);
      return;
    }
    setLooking(true);
    findShopByCode(code)
      .then((shop) => {
        if (!active) return;
        setNotFound(!shop);
        onChange(shop);
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLooking(false));
    return () => {
      active = false;
    };
    // onChange is a render-stable callback in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    void fetchDiscoveryMunicipalities()
      .then(setTowns)
      .catch(() => undefined);
  }, []);

  const matches = useMemo(() => {
    const q = townQuery.trim().toLowerCase();
    if (!q) return [] as MunicipalityOption[];
    return towns
      .filter(
        (t) =>
          t.cityMunicipality.toLowerCase().includes(q) || t.province.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [towns, townQuery]);

  const pickTown = async (t: MunicipalityOption) => {
    setTown(t);
    setTownQuery(`${t.cityMunicipality}, ${t.province}`);
    setLoadingOps(true);
    try {
      setOperators(await fetchShopsInMunicipality(t.province, t.cityMunicipality));
    } catch {
      setOperators([]);
    } finally {
      setLoadingOps(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-code`}>Shop ID</Label>
        <Input
          id={`${idPrefix}-code`}
          inputMode="numeric"
          className="h-11 tracking-[0.2em]"
          value={code}
          onChange={(e) => setCode(normalizeShopCode(e.target.value))}
          placeholder="Enter 7-digit Shop ID"
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          Ask your WiFi voucher operator for their 7-digit Shop ID, or find them by municipality
          below.
        </p>
        {issue && !looking ? <p className="text-xs text-destructive">{issue}</p> : null}
        {looking ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking that Shop ID…
          </p>
        ) : null}
        {notFound && !looking ? (
          <p className="text-xs text-destructive">No shop found with that Shop ID.</p>
        ) : null}
      </div>

      {value ? (
        <div className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2">
          <Store className="mt-0.5 size-4 text-success" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              Shop ID {value.shopCode}
              {value.cityMunicipality ? ` · ${value.cityMunicipality}, ${value.province}` : ""}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCode("");
              onChange(null);
            }}
          >
            Change
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-town`}>Find by city / municipality</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${idPrefix}-town`}
            className="h-11 pl-9"
            value={townQuery}
            onChange={(e) => {
              setTownQuery(e.target.value);
              setTown(null);
              setOperators([]);
            }}
            placeholder="Search municipality"
            autoComplete="off"
          />
        </div>
        {!town && matches.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {matches.map((t) => (
              <li key={`${t.province}-${t.cityMunicipality}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void pickTown(t)}
                >
                  <MapPin className="size-3.5 text-primary" />
                  <span className="flex-1">
                    {t.cityMunicipality}, {t.province}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.shopCount}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {town ? (
          loadingOps ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Looking for operators…
            </p>
          ) : operators.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No WiFi voucher operator is listed there yet.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {operators.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      setCode(o.shopCode);
                      onChange(o);
                    }}
                  >
                    <Store className="size-4 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Shop ID {o.shopCode}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
