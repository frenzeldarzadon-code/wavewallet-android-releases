# Fix automatic voucher batch deletion

## Implementation
- Replace the live `prepare_voucher_batch_cleanup` and `finish_voucher_batch_cleanup` functions with equivalent definitions whose table-column references are fully alias-qualified wherever they can collide with `RETURNS TABLE` output names.
- Preserve authorization, exact stored Omada group matching, automatic/manual classification, advisory locking, retry state, failure recording, and local inventory safeguards.
- Do not change voucher replenishment thresholds, quantities, scheduling, or manual generation.

## Verification
- Add focused database regression coverage for automatic exact-group preparation/completion, manual local-only deletion, already-absent completion, and isolation between two automatic batches for one product.
- Run the focused TypeScript tests, database regression checks in rollback-only fixtures, and the TypeScript checker.
- Confirm the reported live batch can enter cleanup preparation without the ambiguity error, without performing its real deletion during testing.

## Technical details
- Root cause target: unqualified `remote_cleanup_status` references inside PL/pgSQL functions that also declare `remote_cleanup_status` as a `RETURNS TABLE` output variable.
- Database change will be an additive function-replacement migration only; no table or data changes.