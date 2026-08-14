# Multi-Ecosystem Memberships (one login, independent membership per shop)

## What the audit found

The current data model assumes **one person = one shop, forever**. Confirmed by direct inspection of the live database:

- `profiles` has a single `ecosystem_id` column, plus shop-specific fields on the same row: `status`, `reseller_id`, `reseller_discount_percent`, `reseller_commission_percent`, `sale_commission_percent`, `handle`.
- `credit_accounts`, `points_accounts` and `social_credit_accounts` each have a **UNIQUE (user_id)** constraint — one wallet per person, not per shop.
- `membership_applications` has **UNIQUE (user_id)** — a person can literally only ever apply once, so they cannot request to join a second shop.
- `user_roles` is **UNIQUE (user_id, role)** and its trigger fills `ecosystem_id` from the profile, so the same role can't exist twice in different shops.
- `current_ecosystem(user)` reads the shop straight off the profile row; **105 of 188 database functions** reference `profiles`/`ecosystem_id`, and 11 call `current_ecosystem`.
- The signup trigger writes one profile with one shop and one application.

So this is exactly the architectural correction described: the membership concept doesn't exist yet, and role/wallet/history are all anchored to the single profile row. UI filters cannot fix it.

## Target model

```text
auth user (one global login)
  └── profile            → global identity: name, email, phone, avatar, bio, preferences
        └── ecosystem_memberships (user_id, ecosystem_id)  ← UNIQUE pair, the authority
              ├── role, status (pending/active/suspended), joined_at
              ├── reseller_id, discount %, commission %, handle
              ├── wallets: credits, points, social credits (per membership)
              └── all money + history rows scoped by ecosystem_id
```

Active ecosystem is chosen by the user from their approved memberships and is resolved **server-side** per request, never trusted from the browser.

## Phases

**Phase 1 — Membership table + safe migration (no behaviour change)**
- Create `public.ecosystem_memberships` keyed `(user_id, ecosystem_id)` with role, status, reseller link, discount/commission, handle, joined_at, audit timestamps; GRANTs + RLS.
- Backfill one membership per existing profile from `profiles` + `user_roles`, preserving role, status, links, rates and join dates exactly. Super Admin gets a platform-level (no ecosystem) record.
- Verify with row-count and per-user comparisons that nothing is dropped, duplicated or altered. Existing code keeps reading the old columns in this phase.

**Phase 2 — Per-ecosystem wallets**
- Drop `UNIQUE (user_id)` on `credit_accounts`, `points_accounts`, `social_credit_accounts`; replace with `UNIQUE (user_id, ecosystem_id)`.
- Existing wallet rows are left untouched — each one already carries its shop, so it becomes that shop's wallet. No balance is created, moved or zeroed.
- Update `ensure_wallets` / `ensure_credit_account` and every `on conflict (user_id)` to key on the pair.

**Phase 3 — Active-ecosystem context**
- Add a server-resolved active ecosystem (stored per user, validated against approved memberships) and rewrite `current_ecosystem()` to return it instead of the profile column.
- Rewrite `has_role`, `is_ecosystem_admin`, `can_impersonate`, `enforce_role_tenant` and the role helpers to take/derive an ecosystem, so a role in shop B grants nothing in shop A.
- Sweep the ~105 functions that read `profiles.ecosystem_id`, in batches by domain: wallets/ledger, vouchers & shop, cashback/commissions, cash-in/cash-out, rewards/redemptions, applications/approvals, earnings/reports, transfers/recipient search, social, admin/super-admin management, retention/purge.

**Phase 4 — Joining and switching**
- Drop `UNIQUE (user_id)` on `membership_applications`, replace with a partial unique on `(user_id, ecosystem_id)` for open applications so a second shop can be requested but not spammed.
- "Join another shop" flow reusing the existing application + approval workflow; approval creates the membership (and its wallets) in that shop only.
- Ecosystem switcher in the app shell listing only approved memberships; switching changes context only.
- Signup trigger updated to create profile + membership application rather than baking the shop into the profile.

**Phase 5 — RLS, front end, tests**
- Rewrite every ecosystem-scoped policy to authorize through `ecosystem_memberships`, so changing an id in a request cannot reach another shop's rows.
- Front end: `loadAuthContext`/`useSession` return the active membership (role, wallets, subscription) rather than a global role; transfer/recipient search, downlines, earnings and history all follow the active context.
- Audit rows record the acting membership/ecosystem.
- Tests: the Test 1 matrix (Customer/500/100 in Lenas vs Subreseller/5,000/2,000 in Sagada Wave), role change in one shop leaving the other untouched, transfer and purchase isolation, leaving one shop preserving the other, a brand-new user approved separately in two shops, plus SQL policy tests proving cross-shop reads/writes are rejected. Existing 351 tests, typecheck and production build must stay green before any publish.

## Notes and assumptions

- **Profile fields**: name, email, phone, avatar, bio, preferences stay global. `status`, `reseller_id`, discount/commission rates and `handle` move to the membership (handle stays unique per shop, as today).
- **Super Admin** stays platform-level with no ecosystem membership requirement; issuance keeps minting into the recipient's ecosystem wallet.
- Old `profiles.ecosystem_id` and role columns are kept as read-only mirrors until Phase 5 completes, then retired — so no phase can strand existing users.
- This is a large multi-migration change touching most of the database surface; it will run as several reviewed migrations rather than one, and nothing publishes until the full suite passes.

Open question, if you have a preference: for existing members, should the **first** ecosystem they belong to be their default active shop on next login (that's what I'll do unless you say otherwise)?
