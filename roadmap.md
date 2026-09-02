# Roadmap — Phase 1: Legacy → Universe voucher shops

- [ ] Migration: `universe` shop kind, universe-aware wallet helpers, lot pool keyed by account, ledger isolation guard
- [ ] Migration: `shop_seller_authorizations`, `universe_wallet_consolidations`, `voucher_sales.seller_id`
- [ ] Migration: `purchase_voucher(_product_id,_quantity,_seller_id)` universe branch (global wallet, seller attribution, shop-scoped points)
- [ ] Migration: universe-aware refund/reverse/load/transfer/cash-in capacity/my_shop_wallets; refuse shop-to-shop transfers with universe shops
- [ ] Migration: `consolidate_universe_wallets`, `wallet_view`, `seller_storefront`, `universe_sellers_for_shop`
- [ ] Data: convert 4 legacy shops, seed seller authorizations, dry-run + real consolidation, reconciliation
- [ ] Frontend: universe-aware balance/ledger reads, seller storefront on /universe/u/$handle, purchaseVoucher seller param, super.subscriptions filter
- [ ] Tests: SQL regression + vitest; typecheck
- [ ] Final report
