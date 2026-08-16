# WaveWallet — Public Guide, 5-Day Review Shop, Go-Live Conversion

Authoritative update. Supersedes earlier conflicting notes. Nothing here is implemented until approved.

## What already exists (verified in the codebase)

- `ecosystems.shop_kind` ('legacy' | 'subscription'), `is_review`, `review_ends_at`.
- `subscription_plans`, `shop_subscriptions`, `subscription_events`.
- Demo namespace: `demo_wallets`, `demo_ledger`, `demo_vouchers`, isolated from the real ledger by the `guard_shop_kind_ledger` trigger.
- `create_review_shop` (one active review shop per member, 5 days, 1,000 Demo Coins), `subscription_quote`, `activate_subscription`, `run_subscription_expiry` cron (7-day reminder + freeze).
- Guide CMS tables `guide_sections`, `guide_faqs`, `guide_questions` plus `submit_guide_question` / `answer_guide_question`.
- Public `/guide` route (anonymous, SSR), `/start-shop` (sign-in gated), Super Admin `/super/shops` and `/super/guide`.
- Super Admin removed from demo/public role selectors.

So this update is mostly the **experience layer**: marketing-grade public page, review-shop feel and countdown, go-live conversion, in-app Guide tab, contextual help.

## 1. Public Guide (no login) — `/guide`

- Stays the one and only anonymous experience; permanent URL `https://wallet.sagadawave.com/guide`, never renamed.
- Rebuild the page as a marketing landing page in WaveWallet's blue/green/red identity: hero, WiFi-voucher explainer, revolving cashflow diagram, Coins, roles (Admin / Reseller / Subreseller / Customer), Cashback, Points, Cash In/Out, shop isolation, Legacy vs Subscription, plan cards, FAQ, question form, CTA "Sign up / Create your shop".
- No brand logo asset exists in the project today. Plan: generate a small WaveWallet wordmark + hero/OG illustration set (WiFi voucher, wallet/Coin, reseller network) and reuse them everywhere. Confirm if you'd rather supply your own logo.
- Every number stays truthful: "₱50/month plan — 1,000 Coins revolving shop cashflow capacity". All worked examples carry an "Example / simulation" badge.
- Zero financial surface: no wallet, GCash, subscription or payment action reachable anonymously. Every CTA routes to sign-up.
- SEO/OG: unique title, description, `og:image` (absolute URL), `twitter:card`, FAQ JSON-LD, canonical self-reference.

Content stays in `guide_sections` / `guide_faqs` so copy can be corrected later from `/super/guide` on the same URL — no redeploy, no new link. Only structural layout is coded; wording, examples, plan blurbs are data. No AI keys anywhere in the browser.

## 2. Sign-up → shop creation

- Visitor must sign up/sign in to the Universe before `/start-shop` does anything.
- One Universe account may own several shops; the creator becomes **Admin** of the new shop. Super Admin is never granted here.
- Creation produces a real subscription shop row flagged `is_review`, with `review_ends_at = now + 5 days`.

## 3. 5-Day Review Shop (sign-in required)

- Looks and behaves like a live shop: the same Admin/Reseller/Subreseller/Customer navigation and workflows, backed by the demo tables.
- Seeded with 1,000 **Demo Coins**, labelled as Demo/Review Coins everywhere a balance appears, with a distinct badge style so they cannot be read as money.
- Persistent banner with a live countdown ("Review ends in 3d 4h") and a "Subscribe now" CTA.
- Hard blocks (already trigger-enforced server-side, to be mirrored in UI): no real Cash In/Cash Out, no GCash, no cross-shop transfers, no real ledger writes.
- On expiry: demo operations freeze, the shop shows a clear "Subscription required" state, the Universe account and shop record are untouched. No automatic deletion.

## 4. Go-live conversion (same login)

New RPC `convert_review_shop_to_live(shop_id, plan_id)`:

1. Verify caller is Admin of that shop and the shop is a review shop.
2. Void the demo namespace for that shop — zero the demo wallets, archive/void `demo_ledger` and `demo_vouchers`. Demo Coins never cross into real balances.
3. Clear `is_review` / `review_ends_at`.
4. Call the existing one-time allocation path so the plan's real Coins are minted exactly once (Standard → 5,000 real Coins).
5. Write a `subscription_events` audit row.

Shop identity and settings (name, contact, products, branding) are preserved; demo financial rows are not. Same Universe login throughout — no second account.

## 5. Guide tab inside live accounts

- Add "Guide & Help" to the Admin nav (and reseller/customer navs) → `/help`, rendering the same CMS content as the public Guide plus account-context sections.
- Available to review shops and live shops alike.

## 6. Contextual help

- Small `(i)` control component placed on the screens that need explaining (wallet, cash in/out, cashback, points, resellers, vouchers, subscription), each with plain-language copy and a WiFi-voucher example.
- Global "Show guide / Hide guide" toggle in the app shell; preference persisted per member (profile setting, with local fallback).
- Hiding only suppresses the inline overlays; the `/help` tab always stays reachable.

## 7. Public questions & answers

- Anonymous submissions via `submit_guide_question`, rate-limited (per IP/session window + length and link caps + honeypot); nothing is shown until Super Admin approves.
- Only Super Admin can answer/manage, from `/super/guide`.
- Answers render in a distinct box labelled "Answered by WaveWallet Support". No Super Admin name, handle, avatar or account data is ever exposed.

## 8. Public vs private boundary

| Audience | Access |
|---|---|
| Anonymous | `/guide` only — education, plans, FAQ, questions, CTA. No money, no Super Admin. |
| Universe member | Create one 5-day review shop, be its Admin, simulate all roles with Demo Coins. |
| Subscribed shop | Same login, clean live account, one-time real allocation, full Guide. |
| Super Admin | Private owner-only, never public, never in demo, never a public profile. |

## Technical notes and remaining concerns

- **Demo parity cost**: making Reseller/Subreseller/Customer flows work fully on the demo ledger is the largest piece. Proposal: route the existing role screens through a demo-aware data adapter rather than duplicating screens, and cap the simulation at the core loop (issue coins → reseller → subreseller → customer buys voucher → cashback/points). Rarely used admin reports would show "not available in review mode".
- **Multiple review shops**: one active review shop per member stays enforced; a member may still own live shops in parallel.
- **Countdown accuracy**: `review_ends_at` is authoritative server-side; the UI countdown is display only, and the freeze comes from the cron plus a runtime check.
- **OG image caching**: Facebook caches previews; after changing the image you'll need their debugger to force a refresh.
- **Conversion idempotency**: the conversion RPC must be single-shot guarded so a double click cannot mint the allocation twice.
- **Legacy shops untouched** throughout; no destructive migrations, additive only.
