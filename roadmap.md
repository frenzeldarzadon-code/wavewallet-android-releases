# Roadmap — Phase 1: Legacy → Universe voucher shops

- [x] Migration: `universe` shop kind, universe-aware wallet helpers, lot pool keyed by account, ledger isolation guard
- [x] Migration: `shop_seller_authorizations`, `universe_wallet_consolidations`, `voucher_sales.seller_id`
- [x] Migration: `purchase_voucher(_product_id,_quantity,_seller_id)` universe branch
- [x] Migration: universe-aware refund/reverse/load/transfer/cash-in capacity/my_shop_wallets; refuse shop-to-shop transfers with universe shops
- [x] Migration: `consolidate_universe_wallets`, `wallet_view`, `seller_storefront`, `universe_sellers_for_shop`
- [x] Data: 4 legacy shops converted, sellers seeded, dry-run + real consolidation (87,343.72 moved, 0 blocked)
- [x] Frontend: universe-aware balance/ledger reads, seller storefront on /universe/u/$handle, purchaseVoucher seller param
- [x] Tests: rollback SQL scenario + vitest (1262) + typecheck
- [ ] Follow-ups (not Phase 1): publish; `/shop/$slug` seller list UI; buyer purchase history for zero-shop Universe buyers; Retail; cleanup
