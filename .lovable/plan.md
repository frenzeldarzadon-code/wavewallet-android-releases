# Investigation report: is admin cashback counted in "Projected total earnings", and can the figure be negative? (read-only, nothing changed)

## Short answers
- **Yes, the cashback an admin gets on their own purchases is counted.** It is stored as an `admin` commission row. The database turns that row into `admin_shop_margin`, which is the only earning type the admin's Projected figure adds up. It is never labelled `sale_cashback` for an admin.
- **Expenses are not taken off without the matching income.** Both sides use the same lifetime window for the same shop.
- **Nothing in the code stops the figure going below zero.** It shows a minus sign whenever charged expenses are more than the retained margin. With today's data, none of the shops I checked should come out negative (see section 4).

## 1. Which rows the admin Projected figure uses
- `src/components/admin-earnings-panel.tsx:76-83` fetches every earnings row for the shop from 2000-01-01 to now. It then calls `adminNetEarnings(rows, expenses)`.
- `src/lib/role-earnings.ts:74-78`: `earnings = periodTotals(rows, ["admin_shop_margin"])`, then net = earnings − `expensePeriodTotals(expenses)`.
- The card at line 124 shows `net.total`, the lifetime figure.
- `sale_cashback`, `upline_commission` and `wholesale_discount` are left out of the admin figure. Those belong to resellers and subresellers.

## 2. Where admin self-purchase cashback comes from (database function `earnings_history`)
- **Lines 46-76:** each `sale_commissions` row becomes an earning, mapped as `CASE sc.kind WHEN 'upline' THEN 'upline_commission' WHEN 'admin' THEN 'admin_shop_margin' ELSE 'sale_cashback' END`. The admin's self-purchase commission (`kind='admin'`) therefore arrives as **`admin_shop_margin`**. A row counts as `reversed` only when the commission was reversed or the sale refunded.
- **Lines 139-202:** an extra "derived" admin margin row is created only for sales with **no** valid admin commission row (line 200, `NOT EXISTS ... kind='admin' AND reversed_at IS NULL`). This is what stopped self-purchases being counted twice. Points-paid and refunded sales are skipped.
- **Lines 205-240:** approved coin-paid retail orders add their full total as `admin_shop_margin`.
- **Line 130:** the wholesale discount row is only for reseller and subreseller buyers, never admins.

**Live data check (read-only):** every admin self-purchase has a `kind='admin'` commission paid to the buyer themselves, with none reversed:

| Shop | Self-purchase value | Admin cashback recorded (counted in Projected) |
|---|---|---|
| Sagada Wave One-Stop-Shop | ₱50,400.00 | ₱49,900.94 (61 sales) |
| Kawawagan WiFi (Matad-og) | ₱25,070.00 | ₱24,578.44 (10) |
| Guesang GigaFlex | ₱2,170.00 | ₱2,148.50 (6) |
| Lenas Giga Surf | ₱100.00 | ₱99.00 (2) |

## 3. The expense side
- `src/lib/expenses.ts:57-72` `fetchExpenses`: shop expenses (`scope='ecosystem'`) for this shop only, `spent_at` between 2000-01-01 and now, newest 5000 rows.
- `expenses.ts:217-220, 236-238`: only rows with `spent_at <= now` are counted. Each row counts once.
- **Recurring expenses are not double counted.** Every recurring template and occurrence was listed. Each template is the first real charge, and each occurrence falls one month later on its own date. No template shares a date with an occurrence. Example: Pide Starlink Lantagan is ₱4,099 on Sep 3 (template) and ₱4,099 on Oct 3 (occurrence).
- Future occurrences are left out until their date: Sagada's Oct 28 Aguid Starlink and Lenas's Oct 22 Starlink.

## 4. Live totals per shop (my own read-only rebuild of the same rules)
| Shop | Admin commission rows | Sales with no admin row (gross value, an upper limit on the extra derived margin) | Charged shop expenses | Likely lifetime Projected |
|---|---|---|---|---|
| Sagada Wave | ₱112,573.61 | 45 sales, ₱8,070 | ₱82,735.88 | about +₱29,800 to +₱37,900, plus any retail |
| Lenas Giga Surf | ₱23,228.38 | 2 sales, ₱100 | ₱8,198.00 | about +₱15,000 |
| Kawawagan | ₱24,578.44 | none | none | +₱24,578 |
| Guesang | ₱11,648.39 | 2 sales, ₱110 | none | about +₱11,650 |

So with today's data, none of these shops should show a negative lifetime Projected figure. The earlier −₱16,847.94 (minus sign added in commit 85bbd900) can't be reproduced from these totals. It may come from older data, a different shop, or the row-level steps below that I could not run.

## 5. Tests and migrations about admin self-purchase
- `supabase/tests/admin-voucher-net-purchase.sql` and `supabase/tests/admin-earnings-formula.sql`: database tests for the admin net charge and margin rules.
- `supabase/tests/universe-self-purchase.sql`, `src/lib/self-purchase.test.ts`, `src/lib/retail-self-purchase.test.ts`, `src/lib/spending-tracker.test.ts`: self-purchase and tracker reporting.
- `src/lib/role-earnings.test.ts` and `src/lib/expenses-charged.test.ts`: Projected and expense formulas.
- I listed these by name but did not open or run them in this pass.

## 6. What I could and could not verify
- **Verified:** the current function and panel code, how earning types are mapped, the no-double-counting guard, the expense filter, recurring dates, and the live commission and expense totals.
- **Not verified:**
  - I could not call `earnings_history` myself. It needs a signed-in user, so the totals in section 4 are my rebuild, not the function's real output.
  - I have not seen the number the dashboard shows right now.
  - Retail order totals were not added in.
  - Shops other than these four were not checked.

## Suggested next step (if you approve, still read-only)
Sign in to the preview as the admin of the affected shop. Read the Projected and Actual cards and the earnings table. Compare them with the totals above, to tell stale data apart from a display or data-loading problem.
