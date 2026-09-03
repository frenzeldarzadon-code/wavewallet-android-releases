# Shop-free ONE WAVE signup

## Scope
- Replace the public registration path selector with the existing manual account form so users join ONE WAVE directly, without choosing a shop.
- Keep explicit shop links, invitations, and later shop creation/joining as separate intentional flows.
- Route a newly authenticated registration to Universe; preserve email confirmation, validation, duplicate handling, profile creation, and existing-member login behavior.

## Implementation
- Simplify `src/routes/index.tsx` signup state and UI: remove shop finder/operator-choice prerequisites, submit the existing shop-free `signUpCustomerAccount` payload, and show Universe-first success copy.
- Preserve URL-based sign-in behavior and all standalone `/join/...`, invitation, and `/start-shop` routes.
- Add focused regression coverage for the signup destination/zero-membership behavior where practical.

## Backend and security
- No schema, RPC, trigger, RLS, wallet, or financial change is expected: the current `handle_new_user` already creates a global profile with no role or shop membership when no ecosystem slug is supplied.
- Verify this behavior against the current database and confirm no unauthorized membership is created.

## Validation
- Run relevant signup/routing tests, full Vitest, and typecheck.
- Exercise signup UI on mobile and desktop, verify existing sign-in still renders, and confirm the three shop types remain available outside registration.
- Do not publish.
