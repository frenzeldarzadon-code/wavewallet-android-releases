import { describe, expect, it } from "vitest";
import { facebookLabel, isFacebookUrl, resolveEcosystemSupportLink, supportLinkForMember, validateFacebookUrl } from "@/lib/facebook";

describe("validateFacebookUrl", () => {
  it("accepts real Facebook page addresses", () => {
    for (const url of [
      "https://facebook.com/somepage",
      "https://www.facebook.com/some.page.123",
      "https://m.facebook.com/somepage",
      "https://fb.me/somepage",
      "https://m.me/somepage",
    ]) {
      expect(validateFacebookUrl(url), url).toBeNull();
      expect(isFacebookUrl(url)).toBe(true);
    }
  });

  it("treats an empty value as clearing the link", () => {
    expect(validateFacebookUrl("")).toBeNull();
    expect(validateFacebookUrl("   ")).toBeNull();
    expect(isFacebookUrl("")).toBe(false);
  });

  it("rejects non-Facebook, insecure or bare-domain addresses", () => {
    expect(validateFacebookUrl("https://example.com/page")).toMatch(/not a Facebook/i);
    expect(validateFacebookUrl("http://facebook.com/page")).toMatch(/https/i);
    expect(validateFacebookUrl("facebook.com/page")).toMatch(/full address/i);
    expect(validateFacebookUrl("https://facebook.com")).toMatch(/page path/i);
    expect(validateFacebookUrl("https://facebook.com/")).toMatch(/page path/i);
    expect(validateFacebookUrl("https://notfacebook.com/page")).toMatch(/not a Facebook/i);
  });
});

describe("facebookLabel", () => {
  it("prefers the configured page name", () => {
    expect(facebookLabel("https://facebook.com/shop", "Shop Support")).toBe("Shop Support");
  });

  it("falls back to the page path, then a generic label", () => {
    expect(facebookLabel("https://facebook.com/shop", "")).toBe("shop");
    expect(facebookLabel(null)).toBe("Facebook page");
  });
});

describe("support link propagation", () => {
  const ecosystems = [
    { id: "eco-a", name: "Shop A", facebook_page_url: "https://facebook.com/shopa", facebook_page_name: "Shop A Support" },
    { id: "eco-b", name: "Shop B", facebook_page_url: "https://facebook.com/shopb", facebook_page_name: null },
    { id: "eco-c", name: "Shop C", facebook_page_url: null, facebook_page_name: null },
  ];

  it("gives resellers, subresellers and customers their own admin page", () => {
    for (const _role of ["reseller", "subreseller", "customer"]) {
      const link = supportLinkForMember("eco-a", ecosystems);
      expect(link.available).toBe(true);
      expect(link.href).toBe("https://facebook.com/shopa");
      expect(link.label).toBe("Shop A Support");
    }
  });

  it("never leaks another ecosystem's page", () => {
    expect(supportLinkForMember("eco-b", ecosystems).href).toBe("https://facebook.com/shopb");
    expect(supportLinkForMember("eco-zzz", ecosystems).available).toBe(false);
  });

  it("picks up an admin's updated URL without code changes", () => {
    const updated = ecosystems.map((e) =>
      e.id === "eco-a" ? { ...e, facebook_page_url: "https://facebook.com/shopa-new" } : e,
    );
    expect(supportLinkForMember("eco-a", updated).href).toBe("https://facebook.com/shopa-new");
  });

  it("hides the button when the admin has not configured a page", () => {
    const link = supportLinkForMember("eco-c", ecosystems);
    expect(link.available).toBe(false);
    expect(link.href).toBe("");
  });

  it("hides invalid stored values instead of rendering a broken link", () => {
    expect(resolveEcosystemSupportLink({ facebook_page_url: "not a url", facebook_page_name: null }).available).toBe(false);
    expect(resolveEcosystemSupportLink(null).available).toBe(false);
  });
});
