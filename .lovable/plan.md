# Safe automatic voucher batch cleanup

## Goal
When an administrator deletes a fully unused uploaded batch, remove its exact Omada voucher group only when the batch is proven to come from automatic replenishment. Manual generation and unrelated Omada groups remain untouched.

## Current findings
- Automatic imports already use source `omada-auto`.
- Each successful automatic import links `voucher_imports.id` → `omada_voucher_batches.import_id` → the exact stored Omada `group_id`, controller identity, product, and shop.
- The automatic run also links to that Omada batch through `voucher_replenishment_runs.batch_id` with `trigger_source = sweep`.
- Manual Generate creates an `omada_voucher_batches` row too, but has no automatic replenishment run and is imported through the manual path.
- Existing batch deletion is authorized and financially guarded in database functions; it currently deletes local unused codes only.
- Historical completed runaway imports inspected so far retain exact group IDs and can be linked without name/time guessing. Rows without a unique automatic-run + import + group-ID chain will remain unmapped and will never trigger remote deletion.

## Implementation
1. Add persistent cleanup state to the Omada batch record: automatic/manual origin, exact remote group link confidence, cleanup status, attempts, timestamps, and last error. Backfill only rows proven automatic by the existing run/import relationship; leave ambiguous history unlinked.
2. Extend the authorized batch read model so Uploaded Vouchers shows Automatic or Manual and the current remote cleanup status.
3. Add a protected server action for whole-batch deletion:
   - verify the signed-in caller has the existing shop-admin/Super-Admin permission;
   - ask the database to atomically validate the batch and reserve the exact automatic cleanup target;
   - delete only the stored exact `group_id` on the stored shop controller;
   - treat an already-absent exact group as complete;
   - delete local unused inventory using the existing guarded behavior;
   - persist success, safe-unmapped, or remote-failure status and audit details.
4. Never call Omada for manual batches, partial “delete unused” cleanup, or individual-code deletion. Never search by product/name/time during deletion.
5. If remote cleanup fails, retain a durable visible failure record and allow a safe retry against the same immutable group ID only; never select another group.
6. Update Uploaded Vouchers labels and confirmation copy to clearly state Automatic batches attempt exact linked-group deletion, while Manual batches never do.

## Safety and ordering
- Local deletion remains allowed when no safe remote link exists, with a visible “not deleted remotely” result.
- For a reachable linked group, remote deletion is attempted before local deletion so an authorization/local validation failure cannot remove Omada data.
- If Omada succeeds but the local follow-up is interrupted, retry sees the exact group already absent and safely completes local deletion.
- Existing below-100 / exactly-500 replenishment behavior is unchanged.

## Validation
- Automated tests for cases A–G, including two same-product batches with distinct exact IDs and repeated retries.
- Database authorization and mapping tests.
- Focused voucher tests, full test suite, type check, and signed-in mobile review of Uploaded Vouchers.
- Report all historical automatic imports with exact links versus ambiguous/unmapped rows. No publishing or deployment will be performed.
