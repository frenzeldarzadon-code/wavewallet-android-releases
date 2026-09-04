Universe social composer upgrade — DONE (UNPUBLISHED; authenticated browser check pending)
- [x] Inline expanding composer (tap to expand, immediate focus, Post only with valid content, discard confirm)
- [x] Tools: Photo/Video, Location, Feeling/Activity, Direct Message (existing chat), Aa post style with live preview, @/# tagging
- [x] Data: social_posts video_path/meta/hashtags; social_create_post + social_feed extended (no financial changes)
- [x] Feed rendering: media, location, feeling, styled text, clickable hashtags -> /universe/tag/$tag, DM opens existing thread
- [x] Typecheck, tests, 390px + desktop checks; do not publish

Universe as single customer portal — DONE (UNPUBLISHED; authenticated browser check pending)
- [x] Hamburger: Live Monitoring entry -> eligible shop chooser -> existing shop monitor
- [x] Hamburger review: My Wallet, Reward Shops, shops/buying, profile/friends/messages
- [x] Old /app customer portal routes redirect customers to Universe; admin/seller portals untouched
- [x] Typecheck, tests, 390px + desktop

Shop Access cleanup — Universe is the customer portal (DONE — verified with demo accounts; not published)
- [ ] Remove customer-facing join/request-to-join workflow from Universe (My Shops, storefront, shell)
- [ ] Shop Access = management only (admin/reseller/subreseller); customer duplicates hidden/redirected
- [ ] Universe <-> Shop Dashboard switch (multi-shop selector), storefront design reachable from Shop Dashboard
- [ ] Typecheck, tests, demo-account checks 390px + desktop

## Retail: membership-free Universe buying + self-purchase net cashback (done — not published)
- [ ] Remove obsolete "join before ordering" check in retail_place_order (+ any UI)
- [ ] Self-purchase: net wallet charge (price − entitled cashback) in ONE ledger row, audit fields on order
- [ ] Checkout breakdown UI + history label
- [ ] Demo verification, tests, typecheck

## Global self-purchase cashback rule (done — not published)
- [x] Shared self-purchase layer (`universe_self_purchase_net` + `universe_purchase_debit`) used by Retail + Voucher
- [x] Voucher purchase nets self-cashback into one wallet debit
- [x] Transfers unchanged (zero cashback); NG wallets unchanged
- [x] Tests + typecheck + demo verification (live purchase blocked: Demo Preview Shop is frozen)
- [x] Universe seller list: order by real presence (reuse member_presence), status labels, own-shop "Buy from My Shop" button — not published
