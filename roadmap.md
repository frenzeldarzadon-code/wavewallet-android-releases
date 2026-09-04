# Roadmap

- [x] Universe hamburger → Friends (Friends / Find Friends / Following) — `/universe/friends`
- [x] Messages → Online people section (reuse member_presence via `universe_online_members`)
- [x] Retail order chat linked into Messages (existing `dm_threads.kind='order'`, labelled via `dm_order_chat_context`)
- [x] Typecheck, lint, unit tests
- [ ] Demo-authenticated browser walkthrough (blocked: browser auth signed out; SQL console is `supabase_read_only_user` with no RPC execute)
- [x] Remove Universe post audience system (composer selector + backend visibility filtering); all posts public in Universe; NG isolation untouched
