/**
 * The post-purchase screen is the SAME component for Shop Access and Universe.
 * It must state plainly that the purchase succeeded and offer the code plus the
 * save / share / print actions without sending the buyer to history first.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { IssuedVouchersDialog } from "./issued-vouchers-dialog";

afterEach(cleanup);

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

test("shows a clear success state with the code and all actions", () => {
  render(
    <IssuedVouchersDialog
      vouchers={[voucher]}
      summary="1 Day WiFi · P20.00 · TX-1"
      pointsEarned={0}
      saleId="sale-1"
      onClose={() => {}}
    />,
  );
  expect(screen.getByText(/Purchase successful/i)).toBeTruthy();
  expect(screen.getByText("ABC123")).toBeTruthy();
  expect(screen.getByText(/Download Picture/i)).toBeTruthy();
  expect(screen.getByText(/Share/i)).toBeTruthy();
  expect(screen.getByText(/Print/i)).toBeTruthy();
});
