# Points earning: investigation report and fix plan

## What is happening now

For a Voucher Shop purchase, points are calculated from the **displayed sale price**, not from what the buyer's wallet was actually charged.

Inside the purchase routine, the earning line is:

```text
points = sale_price / coins-per-point
```

In New Generation shops a reseller gets a real price discount, so the sale price already equals what they pay — points come out right (₱10 voucher at 30% = ₱7 charged = 0.70 points).

In **Universe** shops the rule is different: nobody gets a price discount; a reseller/subreseller pays the full price and their own share comes straight back as cashback in the same transaction. The routine already records this correctly as `self_cashback` and `buyer_charge`, but the points line still uses the full price.

Real records from the live database confirm it:

| Voucher price | Cashback back to buyer | Actually charged | Points given | Points that should be given |
|---|---|---|---|---|
| 10.00 | 5.00 | 5.00 | 1.00 | 0.50 |
| 50.00 | 25.00 | 25.00 | 5.00 | 2.50 |
| 20.00 | 4.00 | 16.00 | 2.00 | 1.60 |
| 1000.00 | 700.00 | 300.00 | 100.00 | 30.00 |

So Universe resellers and subresellers are earning roughly 1.3x–3x more points than the rule intends.

## Intended rule

Points always come from the coins the member actually parted with: price minus their own cashback/discount, at the shop's configured coins-per-point ratio, kept to two decimals.

## Root cause

- `purchase_voucher` computes `_earn := round(_total / _ratio, 2)` from the gross sale total, *before* the self-purchase netting that produces `buyer_charge`. The netted figure is calculated later in the same function and is never fed back into the points calculation or the points ledger's `credits_basis`.
- The Universe pricing change (no reseller price discount, cashback instead) is what exposed this: previously the discount lived in `sale_price`, so gross and net were the same number.

## Affected flows

- **Affected:** Universe voucher purchases by reseller/subreseller (including self-purchases through their own storefront) — points too high by their own cashback share.
- **Not affected:** New Generation/legacy voucher shops (discount is in the price), plain customers (no self cashback), purchases paid with points (no earning), Super Admin (excluded from self-netting).
- **Separate gap:** retail orders award **no** points at all today — no retail function touches the points ledger. Worth confirming whether that is intended before treating it as a bug.

## Recommended fix

1. Move the points calculation in `purchase_voucher` to after the self-purchase netting, and base it on the amount actually charged (`buyer_charge`), falling back to the sale total when there is no self cashback.
2. Store that same amount as the points ledger's `credits_basis` and on the sale row, so reports and audits show the real basis.
3. Apply the identical rule to the refund/reversal path (`refund_voucher_sale` / `reverse_sale_points`) so a reversal removes exactly what was awarded.
4. Leave the ratio snapshot, per-shop isolation, cashback, commissions and wallet amounts untouched.

### Technical notes

- One migration replacing `public.purchase_voucher` (and the reversal helper if its basis needs re-reading). No table changes.
- Extend `supabase/tests/points-actual-spend.sql` with a Universe case: price 10, cashback 5, expect 0.70/0.50-style netted earning, plus a customer case that must stay unchanged.
- Historical rows: existing over-awarded points are not recalculated by default. Say if you want a one-off corrective adjustment entry for affected members (ledger rules mean an adjustment entry, never an edit).

## Open question

Should retail orders earn points too? If yes, that is a second, separate change.
