/**
 * Self-service address. Members complete or correct their own address at any
 * time — existing accounts created before addresses were captured simply have
 * empty fields here, and nothing forces them to re-register.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AddressFields, EMPTY_ADDRESS, type AddressValue } from "@/components/universe/address-fields";
import { addressIssue, fullAddressLabel, hasRequiredAddress } from "@/lib/ph-address";
import { fetchMyProfile, updateOwnProfile, type MyProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";

export function AddressCard() {
  const { account, actingAs } = useSession();
  const userId = account?.id ?? null;
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [value, setValue] = useState<AddressValue>(EMPTY_ADDRESS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const p = await fetchMyProfile(userId);
      setProfile(p);
      setValue({
        province: p?.province ?? "",
        cityMunicipality: p?.city_municipality ?? "",
        barangay: p?.barangay ?? "",
        street: p?.street ?? "",
        houseNumber: p?.house_number ?? "",
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const problem = addressIssue({
      province: value.province,
      cityMunicipality: value.cityMunicipality,
      barangay: value.barangay,
      street: value.street,
      houseNumber: value.houseNumber,
    });
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await updateOwnProfile({
        province: value.province,
        cityMunicipality: value.cityMunicipality,
        barangay: value.barangay,
        street: value.street,
        houseNumber: value.houseNumber,
      });
      toast.success("Address saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (actingAs) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MapPin className="size-4 text-primary" /> My address
          </p>
          <p className="text-xs text-muted-foreground">
            Province, city/municipality and barangay are used for community search. Your street and
            house/unit number are private and never shown in member search results.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {!hasRequiredAddress(profile) ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
                Your address is not complete yet. Add it any time — nothing else is affected.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Saved: {fullAddressLabel(profile ?? {})}
              </p>
            )}
            <AddressFields value={value} onChange={setValue} idPrefix="my-addr" />
            <Button className="h-11 w-full" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save address"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
