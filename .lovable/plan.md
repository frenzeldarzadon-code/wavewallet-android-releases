# Secure "Access Account" (act-as) with dual-identity audit

Operators (Admin, Super Admin) can enter a downline member's account, act on their behalf, and every mutation is permanently stamped with both the operator and the target identity.

## Scope rules (enforced in the database)

- Admin: only Resellers, Subresellers and Customers whose ecosystem matches the admin's own ecosystem.
- Super Admin: same target roles, any ecosystem.
- Never a target that holds `admin` or `super_admin` role.
- Reseller / Subreseller / Customer: no access at all.
- Acting as a member never grants the operator anything the operator does not already have; the operator's own JWT and role stay in force for every statement.

## Backend (migration)

1. `impersonation_sessions` table: operator_id, operator_name, operator_role, target_id, target_name, target_role, ecosystem_id, reason, started_at, ended_at, ended_reason, user_agent. GRANTs + RLS (operator sees own rows; ecosystem admins and super admins can read rows for their ecosystem; no direct insert/update — only via RPCs).
2. `public.can_impersonate(_operator uuid, _target uuid)` — SECURITY DEFINER, encodes the scope rules above.
3. `public.start_impersonation(_target uuid, _reason text)` — validates, closes any stale session, opens one (hard cap: one active session per operator, auto-expiry after 60 minutes), writes an `audit_logs` row `Access Account — started`.
4. `public.end_impersonation()` — closes the session and writes the matching audit row.
5. `public.acting_as()` → target uuid of the caller's active, unexpired session, else NULL. `public.effective_uid()` → `coalesce(acting_as(), auth.uid())`.
6. Member-facing RPCs that must work "as the member" switch their subject from `auth.uid()` to `public.effective_uid()`, while the audit/actor columns keep the real `auth.uid()`:
   - `purchase_voucher`, `purchase_voucher_with_points`, `request_redemption`, credit transfer.
   - Explicitly NOT switched (blocked while impersonating, with a server-side error and a UI explanation): password/email/security changes, DMs and social posting, role changes, admin/super-admin RPCs, subscription and platform settings.
7. `public.log_operator_action(...)` helper used by the above so each mutation writes an `audit_logs` row with `action = 'Admin Action — Acting as Customer'` (or Reseller / Subreseller, `Superadmin Action — …`) and `metadata` containing operator id/name/role, target id/name/role, ecosystem, entity id, before/after values where safe, reason, session id and user agent. `actor_id`/`actor_name` always stay the operator — history never shows the target as the author.

## Frontend

- `src/lib/impersonation.ts` + `impersonation.functions.ts`: start/end/status calls, eligibility helper, pure functions for the audit label and scope checks (unit-tested).
- `AccessAccountDialog`: confirmation naming the target, role, ecosystem, an optional reason field, and the warning that everything is logged under the operator.
- Entry points: "Access account" row action in `admin.customers`, `admin.resellers`, `reseller`-free (not added), and the Super Admin member screens.
- `/operator/act/$userId` workspace (mobile-first) with tabs: Overview & wallets, Voucher shop purchase, Rewards, Transaction history, Profile. All reads are scoped to the target and already permitted by RLS for the operator.
- Persistent banner (sticky, top, red/amber, rendered in `AppShell` whenever a session is active): "ACTING AS {target} — all changes are recorded under {operator}" plus an "Exit account" button; the banner also shows on every other route so the operator cannot forget.
- Exiting ends the server session and returns to the operator's own dashboard.

## Audit UI

- Super Admin: new "Operator actions" section on the audit/reports screen with filters for operator, target, role, ecosystem, action and date range.
- Admin: the same list filtered to their ecosystem, on their reports screen.

## Verification

- SQL test file `supabase/tests/impersonation.sql`: admin→own-downline allowed; admin→other ecosystem denied; admin→admin/super denied; reseller/customer denied; expired session inert; blocked-action list rejected; audit rows carry both identities.
- Vitest units for label/eligibility/session helpers; full suite, typecheck and build.
- Publish after everything passes.

## Notes / assumptions

- Impersonation runs on the operator's own session with a server-side delegation record — no target JWT is ever minted, so the operator's identity is preserved and no secret (password, hash, OTP, payment credential) is ever readable.
- Historical rows and balances are untouched.
