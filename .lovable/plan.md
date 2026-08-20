# Fix GCash two-layer reconciliation

## Goal
Repair the existing listener/Cash In workflow so stored notifications and completed receipt OCR reconcile securely in either arrival order, without using a profile phone as payment identity or weakening approval checks.

## Implementation
1. **Harden payment identity and status**
   - Add normalized receipt-sender state plus explicit `receipt_verified`, `payment_authenticated`, and `authentication_reason` fields while retaining `receipt_check` for compatibility.
   - Normalize Philippine numbers to `639xxxxxxxxx`; normalize references by removing formatting.
   - Treat a receipt with amount/reference but no sender, receiving destination, or paid time as incomplete—not authenticated.

2. **Unify backend reconciliation**
   - Replace fallback-to-profile/payer matching with receipt sender only.
   - Reconcile on sender + amount + configured/receipt destination, with a bounded paid-time tolerance; never compare listener reference to receipt reference.
   - Use one locked reconciliation function from listener ingestion, Cash In creation, OCR/reprocessing, and manual Attach.
   - Keep unmatched listener events durable and retryable; enforce one-to-one consumption using existing unique/FK protections and atomic row locks.
   - Preserve global duplicate-reference checks and all existing issuance gates.

3. **Recover and diagnose**
   - Add a safe backend reconciliation sweep for pending Cash Ins and unconsumed listener events.
   - Extend pending-review data/UI with precise reasons: missing receipt sender/destination/time, no listener, amount/sender/destination/time mismatch, ambiguity, or duplicate reference.
   - Keep manual Attach as recovery, but route it through identical validation.

4. **Verify production behavior**
   - Add SQL coverage for listener-first, Cash-In-first, delayed OCR sender, missing sender, mismatches, duplicates, ambiguity, and double-consumption.
   - Run focused frontend/unit tests and live read-only verification after the migration/reconciliation.
   - Reprocess the existing ₱75 proof through the current OCR path if possible; approve only if sender, amount, destination, time, and duplicate checks all pass. Otherwise leave it pending with the exact reason.

## Technical notes
- Reuse `listener_events`, `cash_in_requests`, `match_listener_event`, `link_cash_in_listener_event`, `apply_cash_in_receipt_ocr`, and `try_auto_approve_cash_in`; no second listener system.
- The live ₱75 event is safely stored with sender key `639070321959`; its Cash In currently lacks both receipt sender and receipt receiving account, so it must remain pending unless proof reprocessing extracts those required fields.
- No publishing or unrelated changes.
