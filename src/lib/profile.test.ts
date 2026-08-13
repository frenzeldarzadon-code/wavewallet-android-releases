import { describe, expect, it } from "vitest";
import {
  displayHandle,
  initialsOf,
  normalizeHandle,
  validateDisplayName,
  validateHandle,
} from "./profile";
import { coverCrop, optimizedName, validateImageFile } from "./image-optimize";

describe("social handles", () => {
  it("normalizes the @ prefix, case and whitespace", () => {
    expect(normalizeHandle("  @Maria_DC ")).toBe("maria_dc");
    expect(normalizeHandle("@@maria")).toBe("maria");
    expect(normalizeHandle("")).toBe("");
  });

  it("always displays with a single @", () => {
    expect(displayHandle("Maria")).toBe("@maria");
    expect(displayHandle("@maria")).toBe("@maria");
    expect(displayHandle(null)).toBeNull();
  });

  it("accepts allowed characters only", () => {
    expect(validateHandle("maria.dc_1")).toBeNull();
    expect(validateHandle("@maria")).toBeNull();
    expect(validateHandle("ma")).toMatch(/at least/);
    expect(validateHandle("a".repeat(21))).toMatch(/at most/);
    expect(validateHandle("maria dc")).toMatch(/letters, numbers/);
    expect(validateHandle("maria-dc")).toMatch(/letters, numbers/);
    expect(validateHandle("maría")).toMatch(/letters, numbers/);
  });

  it("treats an empty handle as optional, not invalid", () => {
    expect(validateHandle("")).toBeNull();
    expect(validateHandle("   ")).toBeNull();
  });

  it("compares handles case-insensitively so duplicates are caught", () => {
    expect(normalizeHandle("@Maria")).toBe(normalizeHandle("maria"));
  });
});

describe("display name", () => {
  it("requires a name and caps its length", () => {
    expect(validateDisplayName("Maria")).toBeNull();
    expect(validateDisplayName("   ")).toMatch(/required/);
    expect(validateDisplayName("x".repeat(61))).toMatch(/too long/);
  });
});

describe("initials fallback", () => {
  it("uses first and last initials", () => {
    expect(initialsOf("Maria Dela Cruz")).toBe("MC");
    expect(initialsOf("Maria")).toBe("M");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("image optimisation", () => {
  it("rejects unsupported types and oversized files", () => {
    expect(validateImageFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(validateImageFile({ type: "application/pdf", size: 10 })).toMatch(/JPG/);
    expect(validateImageFile({ type: "image/svg+xml", size: 10 })).toMatch(/JPG/);
    expect(validateImageFile({ type: "image/jpeg", size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
  });

  it("centres a square crop inside a landscape photo", () => {
    const rect = coverCrop(1000, 500, 1);
    expect(rect).toEqual({ x: 250, y: 0, width: 500, height: 500 });
  });

  it("centres a 16:10 crop inside a portrait photo", () => {
    const rect = coverCrop(800, 1000, 1.6);
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(500);
    expect(rect.y).toBe(250);
  });

  it("shrinks and clamps the crop when zoomed and panned", () => {
    const rect = coverCrop(1000, 1000, 1, 2, 1, -1);
    expect(rect.width).toBe(500);
    expect(rect.x).toBe(500);
    expect(rect.y).toBe(0);
    const clamped = coverCrop(1000, 1000, 1, 2, 99, -99);
    expect(clamped.x).toBe(500);
    expect(clamped.y).toBe(0);
  });

  it("never zooms below the full frame", () => {
    expect(coverCrop(600, 600, 1, 0.2).width).toBe(600);
  });

  it("names optimised uploads by their encoded format", () => {
    expect(optimizedName("abc", "image/webp")).toBe("abc.webp");
    expect(optimizedName("abc", "image/jpeg")).toBe("abc.jpg");
  });
});
