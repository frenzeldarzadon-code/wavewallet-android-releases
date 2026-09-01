/**
 * The ONE source of truth for the WaveWallet portal card markup.
 *
 * Both the real generated Omada page (portal-template.ts) and the admin design
 * preview (portal-themes.ts) build their body from this module, so the admin
 * can never be shown an old layout that differs from what customers get.
 *
 * Pure string building only: no Omada mechanics, no scripts, no network.
 */

export interface PortalSectionFeatures {
  buyVoucher: boolean;
  signIn: boolean;
  showBalance: boolean;
  showPoints: boolean;
  cashIn: boolean;
  voucherStatus: boolean;
  signUpLink: boolean;
}

export const PORTAL_SECTION_FEATURE_DEFAULTS: PortalSectionFeatures = {
  buyVoucher: true,
  signIn: true,
  showBalance: true,
  showPoints: true,
  cashIn: false,
  voucherStatus: true,
  signUpLink: true,
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PortalSectionsOptions {
  shopName: string;
  features: PortalSectionFeatures;
  /**
   * "runtime" emits the data-ww-* hooks the generated page's script binds to
   * (the real Omada form is moved into #ww-voucher-slot at runtime).
   * "preview" emits inert stand-ins with the same structure and copy.
   */
  mode: "runtime" | "preview";
  /** Footer note shown on the generated page only. */
  portalName?: string | null | undefined;
  /** Preview only: drop the sign-up footer line in tiny thumbnails. */
  compact?: boolean | undefined;
}

/**
 * Section order is contractual: the Omada authentication card
 * ("Already have a code?") is ALWAYS first, the shop / buy-a-voucher card second.
 */
export function portalSectionsHtml(opts: PortalSectionsOptions): string {
  const { shopName, features, mode } = opts;
  const runtime = mode === "runtime";
  const shop = escapeHtml(shopName);

  const buttons: string[] = [];
  if (features.buyVoucher)
    buttons.push(
      `<a class="ww-btn ww-btn-primary"${runtime ? ` data-ww-link="buy"` : ""}>Buy a voucher</a>`,
    );
  const secondary: string[] = [];
  if (features.cashIn)
    secondary.push(`<a class="ww-btn ww-btn-ghost"${runtime ? ` data-ww-link="cashin"` : ""}>Cash In</a>`);
  if (features.voucherStatus)
    secondary.push(
      `<a class="ww-btn ww-btn-ghost"${runtime ? ` data-ww-link="status"` : ""}>Voucher status</a>`,
    );
  if (features.signIn)
    secondary.push(`<a class="ww-btn ww-btn-ghost"${runtime ? ` data-ww-link="signin"` : ""}>Sign in</a>`);

  const balanceNote =
    features.showBalance || features.showPoints
      ? `\n      <p class="ww-sub">Your ${[
          features.showBalance ? "coins" : "",
          features.showPoints ? "points" : "",
        ]
          .filter(Boolean)
          .join(" and ")} and your name appear once you open WaveWallet below.</p>`
      : "";

  /* 1 — the controller's own authentication card. */
  const authCard = `<section class="ww-card">
      <p class="ww-eyebrow"${runtime ? " data-ww-auth-eyebrow" : ""}>Already have a code?</p>
      <h2 class="ww-title" style="font-size:18px"${runtime ? " data-ww-auth-title" : ""}>Enter your voucher</h2>
      ${
        runtime
          ? `<div class="ww-seg" data-ww-methods role="tablist" hidden></div>
      <div class="ww-slot" id="ww-voucher-slot">
        <p class="ww-sub" data-ww-slot-fallback>Use the hotspot login form on this page to enter your code.</p>
      </div>
      <div class="ww-slot" id="ww-auth-action"></div>
      <p class="ww-error" data-ww-error hidden></p>`
          : `<div class="ww-slot"><input type="text" placeholder="Voucher code" readonly><button type="button">Connect with Voucher</button></div>`
      }
    </section>`;

  /* 2 — the shop card that opens the existing Voucher Shop. */
  const shopCard = `<section class="ww-card">
      <p class="ww-eyebrow">${shop} Wi-Fi</p>
      <h1 class="ww-title"${runtime ? " data-ww-greeting" : ""}>Buy a voucher to resume internet</h1>
      <p class="ww-sub"${runtime ? " data-ww-sub" : ""}>Enter the voucher code you already have, or get one in seconds.</p>${
        runtime ? `\n      <p class="ww-sub" data-ww-status hidden></p>` : ""
      }${balanceNote}
      <div class="ww-actions">
        ${buttons.join("\n        ")}
        ${secondary.length ? `<div class="ww-grid">${secondary.join("")}</div>` : ""}
      </div>
    </section>`;

  const signup = features.signUpLink
    ? runtime
      ? `<p class="ww-foot" data-ww-signup hidden>No account yet? <a data-ww-link="signup">Sign up with ${shop}</a></p>`
      : opts.compact
        ? ""
        : `<p class="ww-foot">No account yet? <a>Sign up with ${shop}</a></p>`
    : "";

  const foot = `<p class="ww-foot">Powered by WaveWallet${
    runtime && opts.portalName ? ` &middot; ${escapeHtml(opts.portalName)}` : ""
  }</p>`;

  return [authCard, shopCard, signup, foot].filter(Boolean).join("\n    ");
}
