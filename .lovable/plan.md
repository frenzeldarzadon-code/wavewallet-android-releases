# Wallet Center — one place for balances, history and every allowed transfer

## Goal

Replace the scattered Wallet / Transfer / Transaction history pages with a single **Wallet Center** for every role that holds wallets (customer, subreseller, reseller, admin), containing:

- **My Wallets** — one card per shop the account belongs to, with balance and role in that shop.
- **Transaction History** — filtered by the selected shop, newest first.
- **Send Credits** — to recipients the database already permits, plus the new subreseller-upward paths.
- **Transfer Between My Shops** — From shop, To shop, amount, note, review, confirm.

All four live on one screen with a shop selector at the top, so the common actions are one tap away on a phone.

## What the current model already supports (verified)

- `my_shop_wallets()` already returns every active shop membership with its balance — this is the basis for "My Wallets".
- `transfer_credits_between_shops()` already does an atomic same-account cross-shop move via the global Universe wallet, requires an approved active membership in both shops, blocks acting-as, locks rows (`for update`), and charges the platform fee (currently 5 credits). Requirement 3 is largely already built; it just needs to move into the Wallet Center UI.
- `transfer_credits()` moves face value with no commission, but it is hard-wired to the caller's **currently active shop** (`profiles.ecosystem_id`) and cannot target another shop's wallet.
- `can_load_credits()` deliberately **forbids upward transfers**: a reseller or subreseller may never send to an admin or to another reseller. Requirement 1 (subreseller to parent reseller and to the shop admin) is not possible today and needs a new, narrowly scoped database function.
- `reseller_list_subresellers()` / `reseller_subreseller_ledger()` (the Customers/Subresellers tab) are reseller-only and scoped to the reseller's active shop; they stay untouched and keep working.

## Ambiguities in the data model — please confirm

1. **Parent reseller is global, not per-shop.** `profiles.reseller_id` is a single column on the profile, while roles and wallets are per-shop (`ecosystem_memberships`). So a subreseller has ONE parent across all shops. For "send to my parent reseller in each shop" I will require that the same parent also holds an active `reseller` membership in that shop; if not, the upward option for that shop shows only the admin. Confirm, or say you want a per-shop parent (that is a schema change).
2. **"The appropriate admin" can be several people.** A shop can have more than one active `admin` membership. I will list every active admin of that shop and make the subreseller pick one, rather than guessing a primary admin.
3. **Cross-shop fee.** Moving between your own shops currently costs a flat 5 credits (Super Admin earnings). Requirement 3 says "easy" but not free. I will keep the existing fee and show it clearly in the review step. Say if you want it removed for same-account moves.
4. **Existing pages.** I plan to make `/app` (Wallet), `/reseller/wallet` the Wallet Center and turn `/app/transfer`, `/reseller/transfer`, `/app/history`, `/reseller/history` into redirects to it, dropping the duplicate Transfer and Transaction history nav entries. Confirm you want the old links to disappear rather than remain as separate pages.
5. **Admin console.** Admins already have `/admin/wallets` (Wallets & transfers) and `/admin/transactions`, which are shop-management screens, not a personal wallet. I will add the personal Wallet Center to the Admin nav as "My wallet" and leave the shop-management pages alone.

## Implementation

### 1. Database (one migration)

- `wallet_upward_recipients(_ecosystem_id uuid)` — SECURITY DEFINER, `effective_uid()`-based. For a caller with an active `subreseller` membership in that shop, returns the parent reseller (when they hold an active reseller membership in the same shop) and every active admin of that shop, with name, handle, avatar and role label. Returns nothing for anyone else.
- `transfer_credits_in_shop(_ecosystem_id uuid, _recipient_id uuid, _amount numeric, _note text)` — a shop-scoped sibling of `transfer_credits` so the Wallet Center can send from any of the caller's shop wallets without switching the active shop. It reuses the exact same authorization: `require_operational`, `assert_actor_active`, self-transfer block, suspended-recipient block, positive amount, both parties active members of `_ecosystem_id`, and either `can_load_credits()` **or** the new upward rule (caller is a subreseller in that shop and the recipient is their parent reseller or an admin of that shop). Face value, no commission, both ledger rows in one transaction sharing one `tx_id`, plus audit and operator log entries identical in shape to today's.
- Balances stay non-negative because the existing ledger trigger/`for update` locking path is reused; the source wallet row is locked before the debit.
- No change to `transfer_credits`, `transfer_credits_between_shops`, commissions, cashback, points, or any RLS policy.

### 2. TypeScript

- `src/lib/wallet-center.ts` — typed wrappers: `fetchMyShopWallets` (reuse), `fetchUpwardRecipients`, `transferInShop`, plus pure helpers (`validateInShopTransfer`, `projectedBalance`, wallet totals) that are unit-tested.
- Reuse `fetchCreditLedger(userId, ecosystemId)` for the per-shop history and `shop-transfers.ts` for the cross-shop quote.

### 3. UI — `src/components/wallet/wallet-center.tsx`

One mobile-first screen:

```text
[ Shop selector: chips of my shops + total balance ]
[ Balance card for selected shop  •  role badge ]
[ Send credits ] [ Transfer between my shops ]   <- sheet/dialog, review + confirm
[ Transaction history for selected shop ]        <- date/time, direction, amount,
                                                    reason, tx id, balance after
```

- Send Credits offers the existing recipient search plus, for subresellers, a "Send to my reseller / shop admin" shortcut list from `wallet_upward_recipients`.
- Both transfer flows show recipient, amount, fee (cross-shop), resulting balance, a confirm step, and the returned transaction reference on success; balances and history refresh afterwards.
- Rendered by `/app`, `/reseller/wallet` and a new `/admin/wallet`; `/app/transfer`, `/reseller/transfer`, `/app/history`, `/reseller/history` redirect into it. Nav in `src/lib/navigation.ts` collapses Transfer + Transaction history into the single Wallet entry (navigation tests updated).

### 4. Tests

- `supabase/tests/wallet-center-transfers.sql`: subreseller to own parent reseller succeeds; subreseller to shop admin succeeds; subreseller to an unrelated reseller/admin of another shop is rejected; a non-subreseller cannot use the upward path; cross-shop transfer between own wallets succeeds and to another account's shop fails; insufficient balance rejected; both ledger legs share one `tx_id` and no partial row survives a failure.
- Unit tests for the new pure helpers; existing reseller/subreseller and shop-transfer tests must stay green.
- Run the full suite (currently 475 tests) and the production build. No publish.
