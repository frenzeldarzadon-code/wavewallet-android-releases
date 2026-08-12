import { describe, expect, it } from "vitest";
import { facebookLabel, isFacebookUrl, validateFacebookUrl } from "@/lib/facebook";

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
