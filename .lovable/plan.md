# Final Lovable branding cleanup

## Scope and findings
- The public sign-in, sign-up, password reset, 404, loading shell, metadata, favicon, PWA icons, and mobile/desktop screens already show ONE WAVE and contain no app-rendered Lovable badge or logo.
- The published-site “Edit with Lovable” badge is already hidden.
- One app-controlled user-facing area remains: the Super Admin reports page explicitly labels and records “Lovable AI credits”; existing records can also display that provider wording in the expense list.
- The logo seen after email signup is not rendered by the app’s authentication pages. It comes from the platform’s default authentication email/sender experience because no branded email domain/templates are configured. The existing custom web domain can be used, but email-domain setup must be completed before ONE WAVE auth email templates can be installed safely.
- Remaining source mentions in dependencies, generated cloud authentication integration, preview-session security, telemetry, API secret names, tests for preview URLs, and developer comments are internal/technical compatibility references and will not be renamed.

## Changes
1. Replace only the Super Admin-visible Lovable credit wording with neutral “AI service credits” wording while preserving the existing stored category/provider values and accounting behavior for historical compatibility.
2. Sanitize those known historical provider/category/description labels at presentation time so old expense rows no longer expose Lovable branding in the UI; do not rewrite database records.
3. Update focused tests for the display mapping and leave all financial calculations, expense RPC behavior, wallet/order/shop logic, and authorization unchanged.
4. Record this cleanup as complete and unpublished in the roadmap after verification.

## Authentication email branding
- Configure branded ONE WAVE authentication emails only through the supported email-domain/template setup; do not alter authentication code or redirect behavior.
- The required email-domain setup is a user-confirmed project setting. Once completed, install and style the six authentication email types with ONE WAVE branding and the existing logo/colors.
- If setup is not completed, report the default platform-branded auth email as the sole unavoidable remaining Lovable reference rather than attempting a risky workaround.

## Verification
- Re-run the complete source audit and classify every remaining Lovable occurrence as internal/dev versus user-facing.
- Browser-test desktop and mobile sign-in, sign-up, reset-password, unauthenticated/404, and visible Super Admin reporting labels without creating accounts, orders, or financial records.
- Verify favicon/PWA metadata and ONE WAVE titles, run focused tests, full Vitest, and TypeScript checking.
- Do not publish.
