/**
 * Universe member directory.
 *
 * Every Universe member can find every other member, whatever shop they belong
 * to. Results carry identity and area only — the database function decides
 * what is returned, so no balance, contact detail, internal role or exact
 * street address can leak through this screen.
 */
import { Link } from "@tanstack/react-router";
import { Loader2, Search, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberAvatar } from "@/components/member-avatar";
import { ProvinceSelect } from "@/components/universe/address-fields";
import { areaLabel } from "@/lib/ph-address";
import { displayHandle } from "@/lib/profile";
import {
  canSearch,
  EMPTY_FILTERS,
  searchDirectory,
  searchHint,
  type DirectoryFilters,
  type DirectoryMember,
} from "@/lib/universe-directory";

export function MemberDirectory() {
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<DirectoryMember[] | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<DirectoryFilters>) => setFilters({ ...filters, ...patch });

  const proceed = async () => {
    if (!canSearch(filters) || busy) return;
    setBusy(true);
    try {
      setRows(await searchDirectory(filters));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="space-y-1.5">
            <Label htmlFor="dir-q">Name or @handle</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="dir-q"
                className="h-11 pl-9"
                value={filters.query}
                onChange={(e) => set({ query: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && void proceed()}
                placeholder="Search by name or @handle"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dir-province">Province</Label>
            <ProvinceSelect
              id="dir-province"
              value={filters.province}
              onChange={(v) => set({ province: v })}
              placeholder="Any province"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dir-city">City / Municipality</Label>
              <Input
                id="dir-city"
                className="h-11"
                value={filters.cityMunicipality}
                onChange={(e) => set({ cityMunicipality: e.target.value })}
                placeholder="Any"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dir-barangay">Barangay</Label>
              <Input
                id="dir-barangay"
                className="h-11"
                value={filters.barangay}
                onChange={(e) => set({ barangay: e.target.value })}
                placeholder="Any"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{searchHint(filters)}</p>
          <div className="flex gap-2">
            <Button
              className="h-11 flex-1"
              onClick={() => void proceed()}
              disabled={busy || !canSearch(filters)}
            >
              {busy ? "Searching…" : "Proceed"}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setRows(null);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {busy ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows === null ? null : rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Users className="size-4" /> No members match those filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {rows.map((m) => {
              const handle = displayHandle(m.handle);
              const area = areaLabel(m);
              const row = (
                <div className="flex items-center gap-3 px-4 py-3">
                  <MemberAvatar path={m.avatar_path} name={m.full_name} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {handle ?? "Member"}
                      {area ? ` · ${area}` : ""}
                    </p>
                  </div>
                </div>
              );
              return m.handle ? (
                <Link
                  key={m.id}
                  to="/universe/u/$handle"
                  params={{ handle: m.handle }}
                  className="block hover:bg-accent/40"
                >
                  {row}
                </Link>
              ) : (
                <div key={m.id}>{row}</div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
