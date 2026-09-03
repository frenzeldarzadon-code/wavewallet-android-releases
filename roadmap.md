# Roadmap

## Universe free-social + navigation phase — DONE
- [x] Backend: social_create_post never charges; social_exchange retired; effective costs forced to 0
- [x] Frontend: composer/feed/settings free-of-charge cleanup
- [x] Universe shell redesign (3-column desktop, bottom bar mobile)
- [x] /universe/search and /universe/wallet (WalletCenter scope="universe")
- [x] Home quick-start, profile public-identity card
- [x] Typecheck, 1,256 tests, browser check
- [x] Premium Universe UX/UI refinement

## Retail R1 (approved 2026-09-03)
- [x] Wallet routing via wallet kind (Universe global / NG shop wallet)
- [x] Settlement on approve, refund on reject/cancel, ledger pointers, idempotency
- [x] Frozen-shop checks for retail place/approve
- [x] Remove public exposure of seller-only product fields
- [x] SQL + unit tests; typecheck; report

## R6 — Retail COD / collector float (UNPUBLISHED, Retail hidden)
- [x] Backend RPCs + rollback matrix (supabase/tests/retail-r6-cod.sql → RETAIL_R6_TESTS_PASSED)
- [x] Frontend: customer COD checkout, seller orders panel, collector/delivery card (Universe Wallet), admin delivery settings, order-linked chat
- [x] Typecheck + Vitest 120 files / 1293 tests green; residue check clean
- [ ] Publish (awaiting explicit instruction)

## Universe home/profile/messenger/storefront UX revision — COMPLETE (UNPUBLISHED)
- [x] Discover-first Home with real ranked Voucher/Retail shops and products
- [x] Mobile hamburger for secondary navigation; retain useful bottom navigation
- [x] Immediately typeable inline post composer using existing post flow
- [x] Friend-request/member access from menu
- [x] Privacy-aware member presence for Messenger
- [x] Profile cover upload/display using existing identity storage/security pattern
- [x] Shop-scoped Retail Storefront Design entry and theme controls
- [x] Mobile/desktop, security, financial regression, and residue verification
- [ ] Publish only if explicitly requested

- [x] Direction A — Market Pulse approved; Color A / Type A / Discover First locked

## ONE WAVE branding-only rebrand — COMPLETE (UNPUBLISHED)
- [x] Replace user-facing overall app/ecosystem branding with ONE WAVE
- [x] Preserve WaveWallet as the wallet/product function and all internal identifiers
- [x] Verify metadata, PWA, auth, shared shells, Android labels, routes, and regressions
- [x] Do not publish

## Shop-free ONE WAVE signup — COMPLETE (UNPUBLISHED)
- [x] Remove shop/operator choice from public signup and reuse the existing details form
- [x] Create global profiles with zero shop memberships and land new sessions in Universe
- [x] Preserve explicit join, invitation, later shop creation, existing login, and shop isolation flows
- [x] Verify auth UX, membership safety, tests, and typecheck; do not publish

## Final Lovable branding cleanup — COMPLETE (UNPUBLISHED)
- [x] Neutralize Super Admin-visible provider-credit wording without changing stored accounting identifiers
- [x] Sanitize known historical provider labels at presentation time
- [x] Complete source/browser audit, tests, and auth-email limitation report
- [x] Do not publish

## Image cropper live preview — COMPLETE (UNPUBLISHED)
- Shared `ImageCropper` now shows the real photo (own object URL), dimmed cut-away area, crop boundary, live result preview, pinch/scroll/slider zoom, 1:1 drag.
- Profile cover crop/encode/display unified at 3:1 (`PROFILE_COVER_TARGET`).
