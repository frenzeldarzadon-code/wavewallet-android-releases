# Cross-shop parent reseller error — inspection result

No code was changed. This is what I found.

## 1. Exact source of the error

The message "The parent reseller must be a member of this shop" exists in exactly one place: the
database function `public.validate_member_parent()`, run by the trigger

```text
validate_member_parent
BEFORE INSERT OR UPDATE OF reseller_id, ecosystem_id ON public.profiles
```

It raises when the row's `reseller_id` is not an active member of the row's `ecosystem_id`.

Important: this trigger is on the **profiles** table — the legacy single-shop mirror — not on
`ecosystem_memberships`. The per-shop trigger (`ecosystem_memberships_validate_parent` ->
`validate_membership_parent()`) is correct and uses a different wording:
"The parent must be a reseller in this shop".

## 2. Why it fires even when the membership looks fine

`profiles` still carries one global `ecosystem_id` plus one global `reseller_id`. Several flows
rewrite `profiles.ecosystem_id` without clearing the stale parent copied from the previous shop:

- `respond_to_shop_invitation` (accepting an invite when no active shop is set)
- `auto_process_membership_application` and `review_membership_application`
- `switch_ecosystem`, `superadmin_assign_member_to_shop`

If the person is a subreseller in Shop A (so `profiles.reseller_id` = Reseller A) and the profile
pointer moves to Shop B, the trigger sees `reseller_id = Reseller A` against `ecosystem_id = Shop B`
and blocks the write — even though the Shop B membership row itself is perfectly valid.

A second, related hazard: the trigger `profiles_sync_membership` ->
`sync_membership_from_profile()` copies the profile-level `reseller_id`, discount and commission
into `ecosystem_memberships` for whichever shop the profile currently points at. So a profile-level
value from Shop A can be pushed onto the Shop B membership row (or be rejected by the membership
trigger with the other wording).

## 3. Is the behaviour correct?

The *rule* is correct — a parent reseller must belong to the shop where the subreseller lives.
The *implementation* is wrong at the profiles layer: it evaluates a per-shop rule against a global
mirror row that can legitimately hold values belonging to a different shop. So this specific error
is an overly restrictive, stale-mirror false positive, not a genuine hierarchy violation.

Current live data check: 0 profiles currently hold a `reseller_id` that is not an active member of
their `profiles.ecosystem_id`, so nothing is broken right now — the error appears at the moment of
a transition, and the transaction is rolled back.

## 4. The intended multi-shop process, in plain language

1. One login, many memberships. A person can belong to Shop A and Shop B at the same time.
2. Each membership carries its own role, parent reseller, wallet coins, points, vouchers, rewards,
   transactions and history. Nothing crosses the shop boundary.
3. A parent reseller is validated only inside the shop where the subreseller is being created or
   managed — never against any other shop, and never against a global profile field.
4. Being a reseller in Shop A grants no standing in Shop B. Shop B must have its own active
   reseller membership for that person before they can be anyone's parent there.
5. For an admin creating or managing a subreseller: make sure the shop you are working in is the
   active shop (or is explicitly chosen in the dialog), then pick the parent from the list the shop
   itself offers. The parent dropdown must only ever list members with an active `reseller`
   membership in that same shop, so a parent from another shop cannot be selected by accident.

## 5. Does the current implementation satisfy true shop isolation?

Mostly yes at the RPC layer, no at the mirror layer.

Correct today: `promote_to_reseller`, `promote_to_subreseller`, `set_subreseller_parent` and
`restructure_member_role` all resolve the shop via `member_ecosystem_scope(...)` and validate the
parent against `ecosystem_memberships` in that shop only. `validate_membership_parent()` is the
authoritative per-shop guard.

## 6. Remaining risks

- R1 (cause of the reported error): `validate_member_parent()` on `profiles` applies a per-shop rule
  to a global row and blocks legitimate shop transitions for anyone who is a subreseller somewhere.
- R2: `sync_membership_from_profile()` pushes profile-level `reseller_id`, discount and commission
  onto the membership of the current shop — a real cross-shop contamination path for rates and
  parentage.
- R3: `promote_to_subreseller` and `set_subreseller_parent` update `profiles ... where id = _user_id
  and ecosystem_id = _eco`. When the operator manages a shop that is not the member's current profile
  pointer, that update silently matches zero rows, leaving the mirror stale.
- R4: `member_ecosystem_scope()` falls back to `profiles.ecosystem_id` when no explicit shop is
  passed, so any UI that omits the shop id can resolve the wrong shop.
- R5: two different error wordings for the same conceptual rule make support diagnosis harder.

## 7. Suggested fix direction (not applied)

Make `ecosystem_memberships` the only authority for parentage: relax `validate_member_parent()` so
it only rejects a genuinely invalid parent for the shop, or drop the parent check from the profiles
trigger entirely; make the profile mirror derive from the active membership instead of the reverse;
and have the shop-transition flows clear or re-derive `profiles.reseller_id` from the target shop's
membership. Say the word and I will write that as a migration plan with tests.
