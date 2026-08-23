# Verification: what permanent shop deletion actually removes

No code or database was changed. Findings come from reading `delete_own_shop`,
`purge_ecosystem_internal`, the foreign keys on `ecosystems` / `profiles`, and current row counts.

## Short answer

**No — the current implementation does not preserve members in the Universe.**
It is tenant-scoped for *most* data, but it permanently deletes the profile rows of every
member whose "home" shop (`profiles.ecosystem_id`) is the deleted shop — including members who
also belong to other shops.

## 1) Users / members

`purge_ecosystem_internal` collects:

```text
_members := all profiles where profiles.ecosystem_id = <deleted shop>  (super admins excluded)
```

and near the end runs `delete from public.profiles where id = any(_members)`.

So membership in the deleted shop is not what is scoped — the *home shop pointer* is. Any member
whose home pointer is that shop is deleted outright, not just unlinked.

## 2) Global identity / account

- The `profiles` row is the global Universe identity (name, unique @handle, avatar). It is deleted.
- Rows that cascade off `profiles` go with it: `login_usernames`, `notification_preferences`,
  `social_follows`, `social_friendships` (all `ON DELETE CASCADE`).
- The `auth` login itself is *not* deleted by this function (unlike
  `superadmin_delete_platform_user`, which anonymises the profile and keeps history). The result is
  a login that still exists but has no profile — an orphaned account that cannot present an identity
  in the Universe.
- Contrast: `profiles.ecosystem_id` and `profiles.active_ecosystem_id` are both
  `ON DELETE SET NULL`, so the database was already designed to let a profile survive its shop.
  The explicit `delete from public.profiles` overrides that design.

## 3) Membership in the deleted shop

`ecosystem_memberships.ecosystem_id` is `ON DELETE CASCADE`, so membership rows for the deleted shop
disappear correctly and automatically. Per-shop wallets, roles, ledgers, vouchers, rewards,
subscriptions, cash-in, listener config, payment methods, spending categories and audit rows are all
deleted by explicit `ecosystem_id`-scoped statements. That part is correct and properly isolated.

## 4) Other shops' data

Other shops are unaffected. Every delete in the function is filtered by `ecosystem_id`, and
platform-level history is detached rather than destroyed (`platform_credit_issuances.ledger_id`,
`listener_events.consumed_cash_in_id`, `verified_payments.consumed_cash_in_id` set to null).
The `platform_deletion_log` record and the platform-level audit entry are written outside the shop
and survive.

**But** a member of another shop is affected if the deleted shop was their home pointer: their
profile deletion cascades their follows/friendships and their identity, so their remaining
memberships in surviving shops point at a user with no profile.

## Current exposure in live data

- 41 shop memberships; 6 users belong to more than one shop; 9 profiles have a membership in a shop
  other than their home shop; 13 profiles are Universe-only (no home shop).
- So the risk is real today, not theoretical: deleting a shop that is the home pointer for any of
  those 9 profiles would remove Universe identities that still belong elsewhere.

## What would need to change (not implemented)

1. In `purge_ecosystem_internal`, stop deleting `profiles`. Instead, for each affected member:
   - clear `ecosystem_id` / `active_ecosystem_id` (or repoint `active_ecosystem_id` at another
     surviving membership), and
   - delete only the shop-scoped `user_roles` rows (already done).
2. Keep the profile, @handle and Universe presence intact so the member remains a Universe user with
   zero shops — which the product already supports (13 such profiles exist).
3. Optionally, only for members left with no profile-worthy trace, route them through the existing
   `superadmin_delete_platform_user` anonymisation path rather than a hard delete.
4. Add regression coverage: shop A deleted while member also belongs to shop B ⇒ profile, handle and
   shop B membership all survive; member with only shop A ⇒ profile survives as Universe-only.

Say the word if you want this change implemented; nothing has been modified.
