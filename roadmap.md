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

## Universe home/profile/messenger/storefront UX revision — IN PROGRESS
- [x] Discover-first Home with real ranked Voucher/Retail shops and products
- [x] Mobile hamburger for secondary navigation; retain useful bottom navigation
- [x] Immediately typeable inline post composer using existing post flow
- [x] Friend-request/member access from menu
- [x] Privacy-aware member presence for Messenger
- [x] Profile cover upload/display using existing identity storage/security pattern
- [x] Shop-scoped Retail Storefront Design entry and theme controls
- [ ] Mobile/desktop, security, financial regression, and residue verification
- [ ] Publish only if explicitly requested

- [x] Direction A — Market Pulse approved; Color A / Type A / Discover First locked
