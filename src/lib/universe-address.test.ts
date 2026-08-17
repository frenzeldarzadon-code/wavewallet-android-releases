import { describe, expect, it } from "vitest";
import {
  addressIssue,
  areaLabel,
  fullAddressLabel,
  hasRequiredAddress,
  isKnownProvince,
  PH_PROVINCES,
} from "@/lib/ph-address";
import {
  activeFilterCount,
  canSearch,
  EMPTY_FILTERS,
  searchHint,
  type DirectoryFilters,
} from "@/lib/universe-directory";

const address = (over: Partial<Parameters<typeof addressIssue>[0]> = {}) => ({
  province: "Mountain Province",
  cityMunicipality: "Sagada",
  barangay: "Poblacion",
  ...over,
});

describe("signup / profile address", () => {
  it("requires province, city and barangay", () => {
    expect(addressIssue(address())).toBeNull();
    expect(addressIssue(address({ province: "" }))).toMatch(/province/i);
    expect(addressIssue(address({ cityMunicipality: "" }))).toMatch(/city|municipality/i);
    expect(addressIssue(address({ barangay: "" }))).toMatch(/barangay/i);
  });

  it("never blocks on street or house number", () => {
    expect(addressIssue(address({ street: "", houseNumber: "" }))).toBeNull();
    expect(addressIssue(address({ street: "Rock Inn Road", houseNumber: "12-B" }))).toBeNull();
  });

  it("only accepts a province from the list", () => {
    expect(isKnownProvince("Cebu")).toBe(true);
    expect(isKnownProvince("cebu")).toBe(true);
    expect(isKnownProvince("Atlantis")).toBe(false);
    expect(addressIssue(address({ province: "Atlantis" }))).toMatch(/list/i);
    expect(PH_PROVINCES.length).toBeGreaterThan(80);
  });

  it("knows when an existing account still has no address", () => {
    expect(hasRequiredAddress(null)).toBe(false);
    expect(hasRequiredAddress({ province: "Cebu", city_municipality: "", barangay: "X" })).toBe(
      false,
    );
    expect(
      hasRequiredAddress({ province: "Cebu", city_municipality: "Cebu City", barangay: "Lahug" }),
    ).toBe(true);
  });

  it("keeps street and house number out of the public area label", () => {
    const profile = {
      province: "Cebu",
      city_municipality: "Cebu City",
      barangay: "Lahug",
      street: "Salinas Drive",
      house_number: "42",
    };
    const label = areaLabel(profile);
    expect(label).toBe("Lahug, Cebu City, Cebu");
    expect(label).not.toContain("Salinas");
    expect(label).not.toContain("42");
    expect(fullAddressLabel(profile)).toContain("Salinas Drive");
  });
});

describe("universe member directory filters", () => {
  const f = (over: Partial<DirectoryFilters> = {}): DirectoryFilters => ({
    ...EMPTY_FILTERS,
    ...over,
  });

  it("waits for something to search on", () => {
    expect(canSearch(f())).toBe(false);
    expect(canSearch(f({ query: "j" }))).toBe(false);
    expect(canSearch(f({ query: "ju" }))).toBe(true);
    expect(canSearch(f({ province: "Cebu" }))).toBe(true);
    expect(searchHint(f())).toMatch(/2 characters|province/i);
    expect(searchHint(f({ province: "Cebu" }))).toMatch(/Proceed/);
  });

  it("counts the area filters in play", () => {
    expect(activeFilterCount(f())).toBe(0);
    expect(activeFilterCount(f({ province: "Cebu", barangay: "Lahug" }))).toBe(2);
  });
});
