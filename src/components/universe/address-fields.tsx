/**
 * Shared Philippine address inputs, used on signup and in the profile.
 *
 * Province is a controlled selector; City/Municipality and Barangay are typed.
 * Street and House/Unit number are clearly marked optional and never block a
 * save — the exact street and house number are private and are never shown in
 * the Universe member directory.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PH_PROVINCES } from "@/lib/ph-address";

export interface AddressValue {
  province: string;
  cityMunicipality: string;
  barangay: string;
  street: string;
  houseNumber: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  province: "",
  cityMunicipality: "",
  barangay: "",
  street: "",
  houseNumber: "",
};

export function ProvinceSelect({
  id,
  value,
  onChange,
  placeholder = "Select province",
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Select {...(value ? { value } : {})} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-11">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {PH_PROVINCES.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AddressFields({
  value,
  onChange,
  idPrefix = "addr",
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  idPrefix?: string;
}) {
  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-province`}>Province</Label>
        <ProvinceSelect
          id={`${idPrefix}-province`}
          value={value.province}
          onChange={(v) => set({ province: v })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-city`}>City / Municipality</Label>
          <Input
            id={`${idPrefix}-city`}
            className="h-11"
            value={value.cityMunicipality}
            onChange={(e) => set({ cityMunicipality: e.target.value })}
            placeholder="Sagada"
            autoComplete="address-level2"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-barangay`}>Barangay</Label>
          <Input
            id={`${idPrefix}-barangay`}
            className="h-11"
            value={value.barangay}
            onChange={(e) => set({ barangay: e.target.value })}
            placeholder="Poblacion"
            autoComplete="address-level3"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-street`}>
            Street <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}-street`}
            className="h-11"
            value={value.street}
            onChange={(e) => set({ street: e.target.value })}
            placeholder="Optional"
            autoComplete="address-line1"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-house`}>
            House / Unit no. <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${idPrefix}-house`}
            className="h-11"
            value={value.houseNumber}
            onChange={(e) => set({ houseNumber: e.target.value })}
            placeholder="Optional"
            autoComplete="address-line2"
          />
        </div>
      </div>
    </div>
  );
}
