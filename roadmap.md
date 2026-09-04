# Roadmap

- [x] Universe hamburger → Friends (Friends / Find Friends / Following) — `/universe/friends`
- [x] Messages → Online people section (reuse member_presence via `universe_online_members`)
- [x] Retail order chat linked into Messages (existing `dm_threads.kind='order'`, labelled via `dm_order_chat_context`)
- [x] Typecheck, lint, unit tests
- [ ] Demo-authenticated browser walkthrough (blocked: browser auth signed out; SQL console is `supabase_read_only_user` with no RPC execute)
- [x] Remove Universe post audience system (composer selector + backend visibility filtering); all posts public in Universe; NG isolation untouched
- [x] Retire per-shop post hiding: feed/RLS/visibility helpers ignore `social_post_shop_hides`; hide RPC refuses; UI controls removed. Verified via rolled-back simulation of 7 demo/test accounts (all saw the same posts despite a hide record).
- [x] Universe → Friends → 4th subtab "Friend Requests" (incoming Accept/Decline + sent requests), pending badge on Requests tab and on the Friends menu item; friend-request alert now opens that tab.

- [x] Universe → My Wallet: Cash In / Cash Out / Gift reconnected to existing money flows (`wallet_scope=universe`, global wallet, 1% platform fee, Super Admin review/release). Test: `supabase/tests/universe-wallet-cash-in-out.sql`.
- [x] Payment listener redesign: listener devices capture ALL supported payment notifications (no per-account pairing); receipt vs notification ≥2 independent matches; duplicate-credited receipt → disapproved; blurry/mismatch → manual review; Super Admin UI wording; tests

- [x] Cash In sender/receiver semantics + full receipt/notification extraction: receiver-side notifications without a payer number no longer block approval; payer-name identity signal now links events; semantic SQL test passes (rolled back).

- [x] Listener source detection + Super Admin source blocklist (read all notifications, channel/category capture, detected-sources card with Block/Unblock, audited rules)

- [x] Consolidated final audit of payment listener + Cash In: receiving-account gate test fixed & passing (9/9); older suites (no-pairing, two-signal, payment-first, semantics) aligned with final rules (receipt read first, receiver evidence required, credited duplicates refused at submission); provider-neutral Super Admin/go-live wording; typecheck + 1,422 unit tests pass. Not published.
