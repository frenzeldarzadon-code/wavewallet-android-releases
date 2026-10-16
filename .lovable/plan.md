# Investigation report: "Projected" earnings on the dashboard (read-only, nothing changed)

## 1. What the metric is really called
No label in the code says "Projected Income". The closest match is the card **"Projected total earnings"**:
- Admin dashboard: `src/components/admin-earnings-panel.tsx:122-131`
- Reseller / subreseller dashboard: `src/components/seller-earnings-panel.tsx:94`
Its partner is **"Actual total earnings"** (`admin-earnings-panel.tsx:132-137`). The Sales Report's "Projected / Actual sales" (`sales-attribution-panel.tsx`) is a different figure: voucher sales only, with no expenses taken off.

## 2. Time window: all-time (lifetime), with no date filter
- `admin-earnings-panel.tsx:76`: `const from = lifetimeFrom();` and `src/lib/earnings.ts:437`: `lifetimeFrom()` returns `2000-01-01`.
- Line 79 fetches earnings from 2000-01-01 to now. Line 80 fetches expenses the same way (`limit: 5000`).
- The card shows `totals.net.total` (or `totals.earnings.total` when there are no expenses). `total` is the **lifetime** bucket (`earnings.ts:364`, `out.total +=` with no date check).
- The dashboard has no date selector. Today / month / quarter / year (Asia/Manila calendar) only appear in the table below the cards (`PeriodEarningsTable`, lines 141-175), never on the card.

## 3. Exact formula (admin)
```text
Projected = sum(earning_amount of settled admin_shop_margin rows, lifetime)
          - sum(amount of expenses with spent_at <= now, lifetime, newest 5000)
```
Code path:
- `role-earnings.ts:74-78` `adminNetEarnings`: `earnings = periodTotals(rows, ["admin_shop_margin"])`, `spent = expensePeriodTotals(expenses)`, `net = subtractPeriods(earnings, spent)`
- `earnings.ts:356-374` `periodTotals`: skips `status === "reversed"`
- `expenses.ts:236-238` `expensePeriodTotals` gives `periodTotalsOf(chargedExpenses(rows), spent_at, amount)`
- `expenses.ts:217-220` `chargedExpenses` keeps only rows where `spent_at <= now` (added in commit ba51bd37)
- `admin-earnings-panel.tsx:124` passes the result to `signedPeso(...)`, so a minus sign is shown (added in commit 85bbd900, `actual-earnings.ts:142-145`). Nothing stops the value going below zero.

Resellers and subresellers: `role-earnings.ts:45-49` adds `sale_cashback + upline_commission + wholesale_discount`. These members have no recorded expenses.

## 4. What is included and what is left out
- **Sold vouchers, used or not:** included. Each settled `admin_shop_margin` row counts in full, whatever state its codes are in.
- **Used vs unused:** only Actual uses this. `actual-earnings.ts:35-53` keeps a row only if it is a voucher sale, the buyer's role at sale time was admin, reseller or subreseller, and at least one code is `in_use` or `expired`. The row then counts `earning_amount x used / total codes`.
- **Retail orders:** in Projected if `earnings_history` gives them an `admin_shop_margin` row (the panel comment, line 8, says it does). Left out of Actual because they have no `sale_id`.
- **Admin self-purchase cashback:** in Projected only as the one `admin_shop_margin` row that `earnings_history` returns. The earlier fix stops this row being duplicated. That rule lives in the database function and could not be re-checked here (see section 7).
- **Reversed / refunded sales:** left out of both.
- **Expenses:** every row with `spent_at <= now` is taken off, once, from both Projected and Actual (line 92 passes in the same `net.expenses`).
- **Recurring expenses:** the code has no recurring logic. Each recurring template and each generated occurrence is a separate row, judged only by its own `spent_at`. Future occurrences are dropped. A template that is dated in the past and also has past occurrences counts each of them as a real charge.
- **Not earnings:** platform-issued coins, cash in, transfers and withdrawals. These are not `admin_shop_margin` rows.

## 5. Why the figure can stay negative
Lifetime expenses are taken from lifetime margin. The figure goes negative whenever charged expenses since the shop began are more than everything the shop has retained. Specific causes in the code:
1. **Expenses are set against margin only.** Gross sales value and admin cashback do not offset them. An admin who mostly buys for themselves earns a small margin, while expenses such as the 4 x ₱4,099 entries found earlier can be large.
2. **The window is lifetime.** One large past expense keeps the figure negative for good. Nothing resets by period.
3. **The 5000-row limit (`limit: 5000`)** only matters with more than 5000 expenses. It would make a loss look smaller, not larger.
4. **Recurring templates dated in the past** count as charges. If a template and its first occurrence were both recorded, that expense counts twice. This needs checking against the data. Earlier test 2 (`expenses-charged.test.ts`) shows template and occurrence counted together while they fall on different dates.
5. **Before commit ba51bd37,** future-dated expenses (about ₱16,400) were also taken off, and only the newest 200 expenses were read.
6. **Before commit 85bbd900,** losses were shown without the minus sign.

## 6. The two commits
- **85bbd900** "Fixed actual earnings logic": changes `admin-earnings-panel.tsx`, `seller-earnings-panel.tsx` and `actual-earnings.ts` (adds `actualNetPeriodTotals` and `signedPeso`) and adds tests.
- **ba51bd37** "Fixed future-dated exp. logic": changes `expenses.ts` (adds `chargedExpenses` and `expensesInRange`), `admin-earnings-panel.tsx` and `super-earnings-panel.tsx` (expense fetch now ends at now with limit 5000) and adds `expenses-charged.test.ts`.
Both are in the current code, as described above.

## 7. Uncertainties
- I could not read the live totals. The read-only query was refused: `permission denied for function earnings_history`. So I have not confirmed which shop's negative value comes from which expense rows.
- How `admin_shop_margin` handles admin self-purchases and retail is decided inside the `earnings_history` database function, which I did not re-read in this pass.
- Whether recurring templates are double counted depends on how they are stored. It needs a data check.

## Suggested next step (if you approve)
Read-only only: re-read the `earnings_history` definition. Then, for the affected shop, list lifetime `admin_shop_margin` total, charged expenses grouped by recurring template vs occurrence, and the largest expense rows. That confirms the exact cause of the negative value. Still no code changes.
