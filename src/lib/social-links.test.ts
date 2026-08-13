import { describe, expect, it } from "vitest";
import {
  EXTERNAL_LINK_PROPS,
  normalizeUrl,
  platformLabel,
  prettyUrl,
  validateLabel,
  validateLink,
} from "@/lib/social-links";

describe("url normalization", () => {
  it("adds https when the member omits the scheme", () => {
    expect(normalizeUrl("facebook.com/sagadawave")).toBe("https://facebook.com/sagadawave");
  });

  it("upgrades http to https and drops fragments", () => {
    expect(normalizeUrl("http://example.com/me#top")).toBe("https://example.com/me");
  });

  it("rejects dangerous schemes", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,<script>")).toBeNull();
    expect(normalizeUrl("mailto:me@example.com")).toBeNull();
  });

  it("rejects nonsense and empty input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("https://localhost")).toBeNull();
  });

  it("rejects addresses that are too long to store", () => {
    expect(normalizeUrl(`https://example.com/${"a".repeat(400)}`)).toBeNull();
  });
});

describe("per-platform validation", () => {
  it("accepts a matching host, including www and mobile subdomains", () => {
    expect(validateLink("facebook", "https://www.facebook.com/wave")).toBeNull();
    expect(validateLink("x", "https://twitter.com/wave")).toBeNull();
    expect(validateLink("youtube", "https://youtu.be/abc")).toBeNull();
  });

  it("rejects a link that does not belong to the chosen platform", () => {
    expect(validateLink("instagram", "https://example.com/wave")).toMatch(/Instagram/);
  });

  it("accepts any valid site for website and custom links", () => {
    expect(validateLink("website", "https://sagadawave.com")).toBeNull();
    expect(validateLink("custom", "https://linktr.ee/wave")).toBeNull();
  });

  it("rejects an unsafe link even for custom", () => {
    expect(validateLink("custom", "javascript:alert(1)")).toMatch(/full web address/);
  });
});

describe("presentation helpers", () => {
  it("shortens a url for display", () => {
    expect(prettyUrl("https://www.instagram.com/wave/")).toBe("instagram.com/wave");
  });

  it("labels known platforms", () => {
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("custom")).toBe("Other link");
  });

  it("opens external links without leaking the referrer or window handle", () => {
    expect(EXTERNAL_LINK_PROPS.target).toBe("_blank");
    expect(EXTERNAL_LINK_PROPS.rel).toContain("noopener");
    expect(EXTERNAL_LINK_PROPS.rel).toContain("noreferrer");
  });

  it("limits label length", () => {
    expect(validateLabel("Shop")).toBeNull();
    expect(validateLabel("x".repeat(60))).toMatch(/under/);
  });
});
