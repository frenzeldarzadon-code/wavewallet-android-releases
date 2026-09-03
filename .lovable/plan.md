# Focused Universe UX revision

## Build
- Replace the Home quick-start card stack with a compact Discover First surface: real featured shops, ranked top-selling shops, and ranked top-selling products, each linked to the correct Voucher or Retail destination and with honest limited/empty states.
- Keep the five-item mobile bottom navigation; add a polished hamburger sheet for Alerts, shops, members, friend requests/relationships, profile, wallet, shop console, and sign-out.
- Make the Home composer immediately typeable while reusing the existing audience, photo, mention, promotion, review, and publish flow.
- Add privacy-aware member activity for direct-message participants only; show “Online now” from a short authenticated activity window and do not expose broad member tracking.
- Add a profile cover image using the existing private avatar storage pattern, crop/compression, own-profile authorization, and public-profile masking rules.
- Rename and clarify the existing Retail settings area as “Storefront Design,” then add restrained, shop-scoped visual theme choices that only affect that selected Retail storefront’s public/customer header.

## Guardrails
- Reuse existing routes, components, tables, permissions, and storage buckets; no parallel social, shop, messaging, or storefront systems.
- Keep New Generation excluded from Universe discovery and preserve Voucher/Retail destination separation.
- Do not change R4–R6 pricing, COD, cashback, delivery, collector, settlement, wallet, platform-fee, or order logic.
- Do not publish.

## Technical details
- Add narrowly scoped database fields/RPC output for profile cover, private DM presence, storefront theme, and read-only ranked discovery. Preserve existing RLS and SECURITY DEFINER caller checks.
- Update generated backend types after migration, then wire the existing React surfaces with semantic design tokens and existing Button/Sheet/Tabs components.
- Add focused unit/database tests for ranking, destinations, presence privacy, cover ownership, theme shop scoping, NG isolation, and financial invariants.

## Verification
- Run typecheck, full Vitest, targeted rollback SQL/security checks, financial regressions, and residue checks.
- Verify signed-in mobile and desktop flows with browser screenshots and console/network checks.
