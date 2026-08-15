import { describe, expect, it } from "vitest";
import {
  canSendUpward,
  emptyRecipientsHint,
  filterRecipientsByTab,
  lineageResetNotice,
  recipientTabs,
  tabEmptyHint,
  recipientRelationLabel,
  transferSectionTitle,
  projectedBalance,
  totalWalletBalance,
  upwardRelationLabel,
  validateInShopTransfer,
  type WalletShop,
} from "@/lib/wallet-center";

const shops: WalletShop[] = [
  { ecosystemId: "a", ecosystemName: "Shop A", balance: 120.5, role: "subreseller" },
  { ecosystemId: "b", ecosystemName: "Shop B", balance: 10, role: "customer" },
];

describe("totalWalletBalance", () => {
  it("adds every shop wallet", () => {
    expect(totalWalletBalance(shops)).toBe(130.5);
  });
  it("is zero with no wallets", () => {
    expect(totalWalletBalance([])).toBe(0);
  });
});

describe("projectedBalance", () => {
  it("subtracts the amount", () => {
    expect(projectedBalance(100, 25)).toBe(75);
  });
  it("never goes negative", () => {
    expect(projectedBalance(10, 40)).toBe(0);
  });
});

describe("canSendUpward", () => {
  it("is true only for a subreseller of the selected shop", () => {
    expect(canSendUpward(shops[0]!)).toBe(true);
    expect(canSendUpward(shops[1]!)).toBe(false);
    expect(canSendUpward(null)).toBe(false);
  });
});

describe("validateInShopTransfer", () => {
  const base = { ecosystemId: "a", recipientId: "r", amount: 50, balance: 100 };
  it("accepts a valid transfer", () => {
    expect(validateInShopTransfer(base)).toBeNull();
  });
  it("requires a shop", () => {
    expect(validateInShopTransfer({ ...base, ecosystemId: null })).toMatch(/shop wallet/);
  });
  it("requires a recipient", () => {
    expect(validateInShopTransfer({ ...base, recipientId: null })).toMatch(/recipient/);
  });
  it("rejects a non-positive amount", () => {
    expect(validateInShopTransfer({ ...base, amount: 0 })).toMatch(/positive/);
  });
  it("rejects more than the wallet holds", () => {
    expect(validateInShopTransfer({ ...base, amount: 500 })).toMatch(/more than/);
  });
});

describe("upwardRelationLabel", () => {
  it("names the relationship", () => {
    expect(upwardRelationLabel("reseller")).toBe("My reseller");
    expect(upwardRelationLabel("admin")).toBe("Shop admin");
  });
});

describe("recipientRelationLabel", () => {
  it("names every relation for an operator viewer", () => {
    expect(recipientRelationLabel("admin", "admin")).toBe("Shop admin");
    expect(recipientRelationLabel("reseller", "subreseller")).toBe("My reseller");
    expect(recipientRelationLabel("subreseller", "reseller")).toBe("My subreseller");
    expect(recipientRelationLabel("customer", "admin")).toBe("Customer");
    expect(recipientRelationLabel("other", "admin")).toBe("Member");
  });
  it("defaults to the privacy-safe wording when the viewer is unknown", () => {
    expect(recipientRelationLabel("admin")).toBe("Can accept your credits");
  });
});

describe("transferSectionTitle", () => {
  it("is role specific", () => {
    expect(transferSectionTitle("subreseller")).toMatch(/reseller/);
    expect(transferSectionTitle("reseller")).toMatch(/subresellers/);
    expect(transferSectionTitle("admin")).toMatch(/members of this shop/);
    expect(transferSectionTitle("customer")).toMatch(/can accept your transfer/);
  });
});

});

describe("emptyRecipientsHint", () => {
  it("always explains why the list is empty", () => {
    for (const role of ["subreseller", "reseller", "admin", "customer", null] as const) {
      expect(emptyRecipientsHint(role)).toMatch(/\w/);
    }
  });
});

describe("recipientTabs", () => {
  it("offers team + customers to shop operators", () => {
    expect(recipientTabs("admin", false).map((t) => t.key)).toEqual([
      "network",
      "customer",
      "shops",
    ]);
  });
  it("offers upline/downline + customers to resellers and subresellers", () => {
    for (const role of ["reseller", "subreseller"] as const) {
      expect(recipientTabs(role, false).map((t) => t.key)).toEqual([
        "network",
        "customer",
        "shops",
      ]);
    }
  });
  it("offers upline + peer customers to a customer", () => {
    expect(recipientTabs("customer", false).map((t) => t.key)).toEqual([
      "network",
      "peer",
      "shops",
    ]);
  });
  it("always offers the cross-shop transfer, single-shop accounts included", () => {
    expect(recipientTabs("customer", true).map((t) => t.key)).toContain("shops");
    expect(recipientTabs(null, false).map((t) => t.key)).toEqual(["network", "peer", "shops"]);
  });
});


describe("filterRecipientsByTab", () => {
  const list = [
    { id: "1", full_name: "A", handle: null, avatar_path: null, role: "admin", relation: "admin" },
    { id: "2", full_name: "B", handle: null, avatar_path: null, role: "customer", relation: "customer" },
    { id: "3", full_name: "C", handle: null, avatar_path: null, role: "subreseller", relation: "subreseller" },
  ] as never;
  it("keeps only upline/downline on the network tab", () => {
    expect(filterRecipientsByTab(list, "network").map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("keeps only customers on the customer and peer tabs", () => {
    expect(filterRecipientsByTab(list, "customer").map((r) => r.id)).toEqual(["2"]);
    expect(filterRecipientsByTab(list, "peer").map((r) => r.id)).toEqual(["2"]);
  });
  it("lists nobody on the cross-shop tab", () => {
    expect(filterRecipientsByTab(list, "shops")).toEqual([]);
  });
});

describe("tabEmptyHint", () => {
  it("always explains the empty tab", () => {
    for (const tab of ["network", "customer", "peer", "shops"] as const) {
      expect(tabEmptyHint(tab, "customer")).toMatch(/\w/);
    }
    expect(tabEmptyHint("network", "reseller")).toMatch(/subresellers/);
    expect(tabEmptyHint("peer", "reseller")).toMatch(/customers/);
    // A customer never reads another member's internal position.
    expect(tabEmptyHint("peer", "customer")).not.toMatch(/reseller|admin/i);
    expect(tabEmptyHint("network", "customer")).not.toMatch(/reseller|admin|upline/i);
  });
});

describe("lineageResetNotice", () => {
  it("warns a customer sending to any upline", () => {
    for (const rel of ["admin", "reseller", "subreseller"]) {
      expect(lineageResetNotice("customer", rel)).toContain("Cashback lineage reset");
    }
  });
  it("stays silent for peer customers", () => {
    expect(lineageResetNotice("customer", "customer")).toBeNull();
  });
  it("stays silent for operators — their lineage rules are unchanged", () => {
    expect(lineageResetNotice("admin", "customer")).toBeNull();
    expect(lineageResetNotice("reseller", "subreseller")).toBeNull();
    expect(lineageResetNotice("subreseller", "admin")).toBeNull();
  });
});

describe("recipientRelationLabel — customer privacy", () => {
  it("never names an internal position to a customer", () => {
    for (const rel of ["admin", "reseller", "subreseller"]) {
      const label = recipientRelationLabel(rel, "customer");
      expect(label).toBe("Can accept your credits");
      expect(label).not.toMatch(/admin|reseller/i);
    }
    expect(recipientRelationLabel("customer", "customer")).toBe("Member of this shop");
  });
  it("keeps operational wording for operators and resellers", () => {
    expect(recipientRelationLabel("admin", "reseller")).toBe("Shop admin");
    expect(recipientRelationLabel("subreseller", "reseller")).toBe("My subreseller");
    expect(recipientRelationLabel("customer", "admin")).toBe("Customer");
  });
});

describe("customer recipient tabs", () => {
  it("offers role-free tab wording and no single-upline framing", () => {
    const labels = recipientTabs("customer").map((t) => t.label);
    expect(labels).toContain("Credit recipients");
    expect(labels.join(" ")).not.toMatch(/upline|reseller|admin/i);
  });
  it("keeps the network wording for resellers", () => {
    expect(recipientTabs("reseller").map((t) => t.label)).toContain("Upline & downline");
  });
});

describe("transferSectionTitle", () => {
  it("does not expose recipient positions to a customer", () => {
    expect(transferSectionTitle("customer")).not.toMatch(/admin|reseller/i);
  });
});
