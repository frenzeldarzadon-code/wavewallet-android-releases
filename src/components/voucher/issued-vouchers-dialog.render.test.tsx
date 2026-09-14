/**
 * The post-purchase screen is the SAME component for Shop Access and Universe.
 * It must state plainly that the purchase succeeded and show the code plus the
 * save / share / print actions, without sending the buyer to history first.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: unknown }) => children as never,
}));

import { IssuedVouchersDialog } from "./issued-vouchers-dialog";

const voucher = {
  code: "ABC123",
  productName: "1 Day WiFi",
  description: null,
  priceLabel: "P20.00",
  shopName: "Test Shop",
  customerName: null,
  paymentStatus: null,
  index: 1,
  total: 1,
  txId: "TX-1",
  issuedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("issued vouchers success screen", () => {
  it("shows the success state, the code and every post-purchase action", () => {
    const html = renderToStaticMarkup(
      <IssuedVouchersDialog
        vouchers={[voucher]}
        summary="1 Day WiFi · P20.00 · TX-1"
        pointsEarned={0}
        saleId="sale-1"
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Purchase successful");
    expect(html).toContain("ABC123");
    expect(html).toContain("Download Picture");
    expect(html).toContain("Share");
    expect(html).toContain("Print");
  });
});
