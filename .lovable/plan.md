# Universe marketplace and profile visual refinement

## Scope
- Keep the existing Universe Home, seller storefront, routing, ranking queries, prices, purchase actions, permissions, and storage architecture unchanged.
- Improve only presentation using existing uploaded assets and the bundled ONE WAVE voucher artwork as an explicit fallback.

## Changes
1. Separate profile covers from opaque identity content so only the avatar overlaps the boundary; allow long display names to wrap and keep the handle/joined date readable on mobile and desktop.
2. Extend the existing Market Pulse result with the shop's already-stored storefront logo and cover paths, without changing ranking or sales calculations.
3. Rework Featured and Top Selling shop cards to show those real images when available, stable image areas, shop type, and existing real rating/sales information; retain horizontal scrolling and See all.
4. Keep real Retail product photos through the current signed-image component. Use deterministic bundled voucher artwork only when voucher products have no upload field, clearly as category artwork rather than a claimed product photo.
5. Enrich the existing seller voucher cards with the same reusable voucher artwork while preserving titles, descriptions, prices, points, availability, and checkout behavior.

## Technical details
- Add only non-financial return fields to `universe_market_pulse`; continue using its current ordering and completed-sales aggregates.
- Reuse the existing private signed URL path for shop/retail assets and existing local voucher artwork pointers.
- Add focused pure tests for deterministic fallbacks/data mapping where practical.
- No schema tables, financial functions, RLS, wallet/order logic, or external imagery.

## Verification
- Run focused tests, full typecheck, and relevant test suite.
- Inspect the live preview at 390px mobile and desktop, including long profile names and image/fallback cards.
- Confirm no layout overlap, no browser errors, no data mutations, and no publication.