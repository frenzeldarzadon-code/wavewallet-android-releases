# Universe: the global layer above ecosystems

## What the audit found (verified against the live database)

The membership foundation from the earlier plan is already in place, so Universe builds on it rather than replacing it.

- `ecosystem_memberships` exists as a real table with `(user_id, ecosystem_id)` plus `role`, `status`, `membership_state`, `reseller_id`, discount/commission percents, `handle`, `joined_at`.
- `profiles` still carries both global fields (`full_name`, `email`, `phone`, `avatar_path`, `bio`, `preferences`, `handle`) and shop-specific mirrors (`ecosystem_id`, `status`, `reseller_id`, three percent columns, `handle`), plus the new `active_ecosystem_id`.
- Membership helpers already exist: `my_memberships`, `active_ecosystem`, `switch_ecosystem`, `has_membership`, `membership_role`, `request_join_ecosystem`, `joinable_ecosystems`, `review_membership_application`, `ensure_membership_wallets`.
- `membership_applications` is already per `(user_id, ecosystem_id)` and drives approvals.
- Social already exists but is **shop-scoped**: `social_posts.audience` is constrained to `'ecosystem' | 'general'`, every social RLS policy reads "Shop members read posts/comments/likes", cross-shop reach is done by `social_post_distributions` (origin shop -> target shop, with moderator review), `dm_threads` carries an `ecosystem_id`, and `social_credit_accounts` are per membership. The whole social/DM surface is currently behind `SOCIAL_ENABLED = false`.
- `create_ecosystem` checks super-admin, creates the row and writes an audit entry — it does **not** assign an Admin. Admin assignment today happens indirectly through signup/approval and role grants.
- `member_social_links` is keyed by `(ecosystem_id, user_id)` — social links are currently per shop, not global.

## Target shape

```text
auth user (one login)
  └── Universe  ← lands here after login
        ├── global profile: photo, name, bio, global @handle, social links, preferences
        ├── Universe feed: posts with an explicit audience, likes, comments, DMs
        ├── ecosystem directory: join requests + switcher
        └── memberships ──> Ecosystem workspace (role, wallets, history, earnings)
                             all financial data stays ecosystem-scoped
```

## Conflicts with the previously planned multi-ecosystem work

| Earlier plan | Change under Universe |
|---|---|
| Profile page inside each role console | Single global profile in Universe; role consoles link to it, no duplicate editors |
| `handle` unique **per shop** | Global `@handle` unique across the Universe; membership `handle` retired (recipient search then matches a global handle but still only lists members of the active shop) |
| Ecosystem switcher in the app-shell sidebar only | Switcher lives in Universe (directory) and stays in the shell as a shortcut |
| Login redirects straight to the role home | Login redirects to Universe; "enter shop" then goes to the role home of the active membership (existing users default to their current ecosystem) |
| Social stays shop-scoped | Social becomes Universe-level with an audience model; existing shop posts become audience = that ecosystem |
| `member_social_links` per shop | Moves to global (one set of links per person) |
| Admin assignment implicit | Explicit Super Admin assignment when creating/managing an ecosystem |

Everything else from the earlier plan (memberships table, per-ecosystem wallets, `current_ecosystem` resolution, RLS through memberships, retiring the `profiles` mirrors) stays exactly as planned.

## Global vs membership fields

- **Global (profiles):** `full_name`, `email`, `phone`, `avatar_path`, `bio`, `preferences`, `handle`, social links.
- **Membership (ecosystem_memberships):** `role`, `status`, `membership_state`, `reseller_id`, `reseller_discount_percent`, `reseller_commission_percent`, `sale_commission_percent`, `joined_at`.
- **Retired from profiles** at the end: `ecosystem_id`, `status`, `reseller_id`, the three percent columns, membership `handle` (kept as read-only mirrors until the sweep completes).

## Phases

**Phase A — Universe identity**
- Promote `handle` to a global unique (case-insensitive) on `profiles`; detect and resolve collisions before enforcing, keeping each person's oldest handle and asking the others to pick a new one on next visit.
- Make `member_social_links` global (`user_id` only, `ecosystem_id` dropped/ignored); dedupe existing rows per person.
- `update_own_profile` edits only global fields; `admin_update_member_profile` edits only membership fields for its own shop.

**Phase B — Universe shell and routes**
- New `/universe` area: feed, compose, notifications-lite, profile, ecosystem directory. Feed-first mobile layout, compact header, card-based, visually distinct from the financial consoles (lighter surface, no money accents).
- Post-login routing goes to `/universe`; "Enter shop" moves into the active membership's console. Existing users keep their current shop as the default active membership.
- Remove per-console profile pages (`/app/profile`, `/reseller/profile`, `/admin/profile`, `/super/profile`) in favour of the Universe profile; keep redirects so old links land correctly. Super Admin platform metrics stay in the Super console.

**Phase C — Ecosystem directory, joining, Admin assignment**
- Directory built on `joinable_ecosystems` + `request_join_ecosystem` + existing approval workflow; approval creates the membership and its wallets in that shop only.
- Extend `create_ecosystem` with an optional admin assignment (existing global user, or an invitation), and add `assign_ecosystem_admin` so Super Admin can set/replace a shop's Admin. Assignment writes a membership with role `admin` in that shop only, and is audited. A shop with no Admin is flagged in the Super console.

**Phase D — Universe social**
- Extend `social_posts.audience` to `'public' | 'ecosystems' | 'ecosystem'` and add a `social_post_audiences (post_id, ecosystem_id)` table for multi-shop targeting. `ecosystem_id` on the post becomes the *origin* shop (nullable for Universe-native posts).
- Visibility rule enforced in SQL, not the client: a post is visible if it is `public`; or the viewer has an active membership in the post's origin shop; or the viewer has an active membership in one of the post's target shops **and** that target's distribution row is approved. Likes/comments/reports inherit the parent post's visibility. `social_post_distributions` is reused unchanged as the per-shop moderation record, so ecosystem Admins keep approving what reaches their shop.
- Announcements: a `kind` on posts (`post` | `announcement`) so Super Admin can post Universe-wide and Admins shop-wide, pinned in the feed.
- Social credits stay per membership; Universe-native public posts use a platform-level social wallet (or are free) — chosen so no shop's credits are spent for a public post.
- DMs become Universe-level: `dm_threads.ecosystem_id` becomes nullable/contextual, threads keyed by participant pair. Privacy is unchanged — participants only, Super Admin excluded.
- The whole surface stays behind `SOCIAL_ENABLED` until the RLS tests pass.

**Phase E — RLS, migration, tests**
- Rewrite social policies to the audience rule above and every ecosystem-scoped policy to authorize through `ecosystem_memberships`, so a swapped ecosystem id cannot read another shop's rows.
- Backfill: existing posts become `audience = 'ecosystem'` targeted at their current shop; existing DM threads keep their participants; existing memberships keep their default active shop.
- Tests: the Test 1 matrix (Customer in Lenas, Subreseller in Sagada Wave, promotion in one shop leaving the other untouched); wallet/history/transfer/earnings isolation; SQL policy tests proving a non-member cannot read a shop-targeted post, that a public post is readable by any Universe member, that DMs are unreadable by non-participants including Super Admin, and that Admin moderation is limited to its assigned shop. Existing suite, typecheck and production build must be green before any publish.

## Notes and assumptions

- Nothing is published or migrated during this planning step.
- Financial semantics are untouched: earnings, cashback, commissions, cash-in/out and retention rules stay ecosystem-scoped and unchanged.
- Super Admin stays platform-level with no shop membership requirement; Admin authority is only ever the shops they hold an `admin` membership in.
- Assumption unless you say otherwise: a global @handle is one per person Universe-wide (so `@test1` is the same person everywhere), and Universe-public posts do not consume a shop's social credits.
