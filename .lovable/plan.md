# Stop duplicate automatic voucher batches

## Fix
- Keep the independent 15-minute background stock check and the exact rule: below 100 available/unused codes creates one 500-code batch.
- Add a database-backed low-stock event state per shop and voucher product. Crossing below 100 opens one event; a successful 500-code import closes it; stock recovering to 100 or more rearms the next event.
- Claim events atomically so concurrent scheduler runs, retries, browser checks, and workers cannot create duplicate batches.
- Pause failed or partial events with their error instead of automatically creating another Omada group every 15 minutes. A later safe retry must resume the same event, not create a second event.
- Keep manual Omada generation separate and functional; remove the Generate screen's manual stock-check trigger so the page is status/manual-generation only.

## Recovery and audit
- Record event identity, attempts, generated/imported counts, Omada group details, failure state, and timestamps.
- Before retrying an uncertain attempt, reconcile its recorded Omada group and import missing codes rather than creating another group.
- Preserve voucher format, product calibration, pricing, duration, limits, and inventory rules.

## Verification
- Cover stock 150, stock 99, post-success 599, a later fresh low-stock event, concurrent checks, manual generation, and Omada failure/partial-result behavior.
- Run focused tests, the full test suite, and type checking.
- Verify scheduler state and recent run records without publishing or changing Android workflow.
