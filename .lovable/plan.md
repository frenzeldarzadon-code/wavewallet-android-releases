# Provider-agnostic receipt ↔ notification matching

## What is already provider-agnostic (verified in the live database and code)

- `record_listener_event` no longer requires the device's own package. It runs the source allow/deny rules first (`listener_source_allowed`), then resolves a provider with `payment_provider_for(package, text)` against `payment_provider_registry`. Unknown app → stored as `non_payment`; blocked app → `source_disabled`; provider known but no amount → `unparsed`.
- `listener_events` already carries `provider_id`, `app_label`, `reference_key`, `sender_number_key`, `amount_php`.
- Matching already enforces the rule you asked for: `listener_match_signals(...) >= 2` **and** `listener_has_strong_signal(...)` (reference or sender must agree; amount alone can never pass), plus a hard veto when both references exist and disagree.
- Duplicate protection is already platform-wide: `payment_reference_seen` (salted hash), `payment_reference_used_elsewhere`, plus a scan of consumed `listener_events`.
- Android already captures every allowed package, applies the cached source rules and a generic money-shape triage, and uploads `title`/`text`/`app_label`/`provider_id`.

So GCash flow, the 1,500 payment path, pairing/revocation and the ≥2-signal rule stay exactly as they are. The gaps below are what actually needs work.

## Confirmed gaps

1. **Receipt reading is GCash-only.** The vision prompt in `src/lib/cash-in-receipt.server.ts` says "You are reading a GCash payment receipt" and only names GCash fields. A Maya or bank receipt is read badly or marked unreadable.
2. **No provider on the receipt/request side.** `cash_in_requests` has no provider column, so `try_auto_approve_cash_in` falls back to `coalesce(_provider, 'gcash')` when there is no listener event — the wrong namespace for a non-GCash reference hash.
3. **No durable match record.** Which signals matched and why approval happened lives only in an `audit_logs` JSON blob and in mutable joins; nothing snapshots the receipt values and the notification values at approval time. Point 5 (history must not depend on current parser/config) is not satisfied.
4. **No learned provider patterns.** Nothing records observed notification shapes per provider, so extraction never improves (point 6).
5. **Signals are number-shaped only.** `sender_number_key` uses `normalize_ph_mobile`; bank receipts often expose a masked account or a payer name instead, so a valid bank payment can reach only 1 signal and stall in review (safe, but never auto-approves).

## Plan

### A. Provider on the receipt side (database + web)

- Add `cash_in_requests.provider_id text` (nullable, FK-less, references registry by id) and `provider_source text` (`member`, `receipt`, `listener`, `method`).
- Resolve it in this order: the payment method the member paid to (`payment_methods.provider_id`) → the OCR reading → the matched listener event. Default stays `gcash` only when nothing else resolves, so existing rows behave identically.
- Use `_row.provider_id` instead of the hardcoded `'gcash'` in `try_auto_approve_cash_in` for reference hashing.

### B. Generic receipt reading with provider hints

- Rewrite the prompt in `cash-in-receipt.server.ts` to be provider-neutral: "reading a payment receipt / transfer confirmation screenshot from an e-wallet or bank app", asking for `provider_name`, `reference`, `amount_php`, `sender_number`, `sender_name`, `sender_account_masked`, `receiving_number`, `receiving_account_masked`, `paid_at`, `readable`, `confidence`.
- Pass the expected provider (from A) and its known receipt vocabulary as a hint when available; never let the hint invent a value.
- Extend `parseReceiptReading` and `receipt_details` to keep the new fields. `receipt_reference`/`receipt_amount_php`/`receipt_sender_number` keep their current meaning, so `apply_cash_in_receipt_ocr` and every existing test keep passing.

### C. Signals that work for banks as well as wallets

- Extend `listener_match_signals` with two extra comparisons, still counting **one each**:
  - masked account tail agreement (last 4 of sender or receiving account, when both sides have one),
  - receiving-account agreement (event's reported receiver vs the shop's configured method).
- `listener_has_strong_signal` stays reference-or-sender; add "matching reference tail + exact amount + same provider within 15 minutes" as a strong signal **only** when no full reference exists on either side. Amount alone still never qualifies.
- Everything GCash already satisfies keeps satisfying it — the current two signals are unchanged, these are additions.

### D. Durable, self-contained match record

- New table `public.payment_match_records`: `id`, `cash_in_id`, `listener_event_id`, `ecosystem_id`, `provider_id`, `matched_at`, `decision` (`auto_approved` | `staged` | `manual_approved`), `signals jsonb` (each signal with name, receipt value, notification value, agreed true/false), `receipt_snapshot jsonb`, `notification_snapshot jsonb` (normalised fields; raw text only for Super Admin), `reference_hash`, `rule_snapshot jsonb`.
- Written inside `try_auto_approve_cash_in` (and on manual approval with a listener event) before settlement, in the same transaction.
- RLS: shop admins read their own ecosystem's rows without raw text; Super Admin reads all. GRANTs per project convention.
- Snapshots are literal copies, so history stays true even if a parser, a provider registry row, or a shop's configuration changes later.

### E. Learned provider patterns (assist only, never authority)

- New table `public.payment_provider_patterns`: `provider_id`, `pattern_kind` (`notification_template`, `reference_shape`, `receipt_label`), `signature text` (text with digits/amounts masked out), `field_map jsonb`, `observed_count`, `first_seen_at`, `last_seen_at`, `confirmed_matches`. Platform-scoped, Super-Admin-readable only — no shop text or payer data.
- On every **successful** match, upsert the masked signature of the notification and of the receipt labels, incrementing counters.
- Patterns feed extraction only: server-side parsing may use a learned signature to pull an amount or a reference the generic parser missed. The extracted value then goes through the identical signal counting and duplicate checks. A pattern is never a signal, never raises confidence, and can never approve on its own.

### F. Duplicate and reuse protection

- Keep the existing hash table; namespace by the resolved provider from A so two providers can legitimately share a reference string.
- Add reuse protection for the receipt itself: store a hash of the receipt image (already uploaded) in the match record, and reject a pending request whose receipt hash was already consumed by another approved request.
- Continue rejecting a listener event that is already consumed by a different cash in.

### G. Android

- No new APK required for A–F. The v1.4.0 code already sends everything the server needs.
- Only documentation/diagnostics wording is touched if anything: no version bump, no build, no publish in this phase.

## What explicitly does not change

Pairing, re-pairing, device revocation, HMAC signing, shop/ecosystem isolation, source allow/deny rules, the ≥2-independent-signal rule, receipt/OCR corroboration requirements, `require_listener_match`, the platform payment option for legacy shops, and the tested GCash 1,500 path.

## Order of work

1. A + B (provider identity end-to-end, generic receipt reading).
2. D (match records) — history becomes durable before matching gets smarter.
3. C (extra signals) + F (receipt reuse).
4. E (pattern learning), last, since it only assists extraction.

Each step ships with SQL tests under `supabase/tests/` and unit tests next to the touched `src/lib` modules. Nothing is published or released.
