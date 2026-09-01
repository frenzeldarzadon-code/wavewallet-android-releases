import { describe, expect, it } from "vitest";
import { isPublicOrigin, resolvePublicOrigin } from "@/lib/public-origin";

describe("canonical public origin", () => {
  it("refuses preview and development hosts", () => {
    expect(isPublicOrigin("http://localhost:8080")).toBe(false);
    expect(isPublicOrigin("https://id-preview--abc.lovable.app")).toBe(false);
    expect(isPublicOrigin("https://project--abc-dev.lovable.app")).toBe(false);
    expect(isPublicOrigin("https://wallet.sagadawave.com")).toBe(true);
  });

  it("prefers the configured production address over anything the browser sent", () => {
    expect(
      resolvePublicOrigin({
        configured: "https://wallet.sagadawave.com",
        request: "https://id-preview--abc.lovable.app",
        suggested: "http://localhost:8080",
      }),
    ).toBe("https://wallet.sagadawave.com");
  });

  it("falls back to the real request address when nothing is configured", () => {
    expect(
      resolvePublicOrigin({
        configured: null,
        request: "https://wallet.sagadawave.com/",
        suggested: "http://localhost:8080",
      }),
    ).toBe("https://wallet.sagadawave.com");
  });

  it("never silently keeps a preview address when a public one exists", () => {
    expect(
      resolvePublicOrigin({ request: "https://id-preview--x.lovable.app", suggested: "https://wallet.sagadawave.com" }),
    ).toBe("https://wallet.sagadawave.com");
  });
});
