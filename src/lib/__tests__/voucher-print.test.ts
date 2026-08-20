import { describe, expect, it } from "vitest";
import {
  VOUCHER_PRINT_HEIGHT_IN,
  VOUCHER_PRINT_WIDTH_IN,
  isVoucherTemplate,
  voucherTemplates,
} from "@/lib/voucher-print";
import { voucherPrintCss } from "@/lib/voucher-print-css";

describe("voucher print templates", () => {
  it("ships exactly five distinct templates", () => {
    expect(voucherTemplates).toHaveLength(5);
    expect(new Set(voucherTemplates.map((t) => t.id)).size).toBe(5);
    expect(voucherTemplates.map((t) => t.id)).toEqual([
      "classic",
      "minimal",
      "modern",
      "dark",
      "colorful",
    ]);
  });

  it("has a style rule for every template and rejects unknown ones", () => {
    for (const t of voucherTemplates) {
      if (t.id === "classic") continue; // classic is the base card style
      expect(voucherPrintCss).toContain(`.vp-t-${t.id}`);
    }
    expect(isVoucherTemplate("modern")).toBe(true);
    expect(isVoucherTemplate("gold")).toBe(false);
  });
});

describe("physical print size", () => {
  it("locks every voucher card to exactly 2in x 1.5in", () => {
    expect(VOUCHER_PRINT_WIDTH_IN).toBe(2);
    expect(VOUCHER_PRINT_HEIGHT_IN).toBe(1.5);
    const card = voucherPrintCss.slice(
      voucherPrintCss.indexOf(".vp-voucher {"),
      voucherPrintCss.indexOf("}", voucherPrintCss.indexOf(".vp-voucher {")),
    );
    expect(card).toContain("width: 2in;");
    expect(card).toContain("height: 1.5in;");
    expect(card).toContain("min-width: 2in;");
    expect(card).toContain("max-width: 2in;");
    expect(card).toContain("min-height: 1.5in;");
    expect(card).toContain("max-height: 1.5in;");
    // Never allowed to stretch or be scaled by the sheet.
    expect(card).toContain("flex: 0 0 auto;");
    expect(voucherPrintCss).not.toMatch(/transform:\s*scale/);
  });

  it("keeps cards whole across pages and hides the controls when printing", () => {
    expect(voucherPrintCss).toContain("page-break-inside: avoid;");
    expect(voucherPrintCss).toContain("break-inside: avoid;");
    expect(voucherPrintCss).toContain("flex-wrap: wrap;");
    expect(voucherPrintCss).toContain(".vp-no-print { display: none !important; }");
  });
});
