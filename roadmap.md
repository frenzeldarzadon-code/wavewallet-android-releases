# Roadmap — Universe free-social + navigation redesign

- [ ] Migration: `social_create_post` never debits social credits or points (posts + promotions free); `social_exchange` retired (refuses); `social_effective_settings` reports zero costs
- [ ] Frontend: social.ts charge helpers → always free; composer/feed drop cost, exchange and pay-with UI; operator pricing cards relabelled as retired
- [ ] Universe shell redesign (X-style: left rail, centre feed, right rail with Search / Profile / Wallet Center; mobile bottom bar)
- [ ] New routes: `/universe/search`, `/universe/wallet`
- [ ] Wallet Center reuse with `scope="universe"` (global wallet only; NG shop wallets excluded)
- [ ] Home quick-start / discovery cards
- [ ] Tests + typecheck + browser check
