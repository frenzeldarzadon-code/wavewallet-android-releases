# Fix Reversal Actions in Admin and Super Admin Mode

## Implementation
- Recognize the production outgoing credit-load transaction format while continuing to exclude incoming legs, purchases, adjustments, and reversal entries.
- Preserve the current transaction row layout, but show a prominent Reverse action for eligible outgoing transfers, Reversed for completed transfers, and the remaining reversible amount/action after partial reversals.
- Keep the confirmation dialog and route every mutation through the existing `reverse_credit_transfer` database function.
- Update reversal persistence and RPC checks to support multiple safe partial reversals up to the original transfer amount, while retaining immutable ledger entries, lot-based unspent-credit checks, tenant authorization, audit logs, and duplicate/full-reversal protection.
- Make transaction-history aggregation cumulative across partial reversal records so both Super Admin ecosystem access and normal Admin mode display the correct state.

## Validation
- Extend unit tests for the real production transaction labels, incoming/purchase exclusions, cumulative partial state, and full completion.
- Extend database regression coverage for partial-then-partial/full reversal, duplicate protection, balance safety, and audit/history preservation.
- Verify the Transactions page in Super Admin Mode and Admin mode with Playwright at desktop/mobile dimensions.
- Run the relevant/full automated tests and publish the completed fix.

## Technical details
- Add a database migration that removes the one-record-per-transfer uniqueness constraint and computes cumulative reversed totals atomically under row locks.
- Continue using ecosystem-scoped reads protected by existing RLS; no accounting, commission, discount, purchase, or refund rules are changed.
