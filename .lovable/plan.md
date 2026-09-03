# ONE WAVE branding-only rebrand

## Scope
- Change the overall application/ecosystem name shown to users from WaveWallet to **ONE WAVE** across browser metadata, install/PWA metadata, authentication, shared app shells, public guides/download surfaces, and native Android labels/about/offline surfaces.
- Keep the existing visual system and wallet icon; pair it with a clean text-only **ONE WAVE** wordmark where brand text is shown.
- Update page titles and descriptions that use WaveWallet as the platform/community owner to ONE WAVE, while keeping **WaveWallet** wherever it specifically names the wallet, Coins, wallet account/history, Payment Listener, voucher records, native bridge, release-signing identifiers, or other functional/product concepts.

## Safety boundaries
- Do not rename internal packages, Kotlin classes, application IDs, routes, files, imports, storage keys, native bridge/user-agent identifiers, API/RPC/database objects, environment variables, domains, or release-signing variables.
- Do not change database migrations, schema, RLS, auth behavior, shop types, order/checkout/R6 state, pricing, fees, cashback, COD, settlement, permissions, or any feature logic.
- Do not regenerate or redesign app icons: the current wallet icon remains appropriate for the WaveWallet product within ONE WAVE.
- Do not publish.

## Implementation
- Introduce/reuse one client-safe display-brand constant so shared user-facing brand text is consistent without touching internal identifiers.
- Update the root and leaf route metadata, PWA manifest, login/signup welcome copy, shared console brand, Universe attribution, public guide/download/install/update wording, and other audited overall-app references.
- Update Android launcher/app label, About title/content, and general offline branding to ONE WAVE; retain “WaveWallet Payment Listener” and all internal Android identifiers because they name a functional module or compatibility contract.
- Add focused branding assertions covering the display brand, manifest, hierarchy, and protected internal identifiers.

## Verification
- Run typecheck, relevant branding and existing regression tests, and production build.
- Browser-check title, manifest, signed-out login branding, and signed-in home branding at mobile and desktop sizes; confirm routes/auth remain healthy.
- Confirm all three shop-type labels remain intact, WaveWallet remains on wallet-specific surfaces, no financial/order files or database objects changed, and no test data/residue was created.
