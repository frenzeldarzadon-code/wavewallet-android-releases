/**
 * Final Omada-compatible portal package.
 *
 * canonical master -> WaveWallet base template -> admin's feature flags ->
 * this file. Pure and deterministic: the same shop, portal and feature set
 * always produce the identical bytes, so the preview the admin sees and the
 * file they download can never differ.
 */
import {
  BASE_SCRIPT,
  BASE_STYLE,
  BASE_TEMPLATE_VERSION,
  baseTemplateInfo,
  byteSize,
  checksumOf,
} from "./portal-base-template";
import {
  escapeHtml,
  generatedFileName,
  normalizeTemplateFeatures,
  type PortalTemplateFeatures,
} from "./portal-template";

export interface PortalBinding {
  /** Deployed WaveWallet origin, e.g. https://wallet.example.com */
  origin: string;
  /** The exact saved controller -> site -> portal mapping. */
  mappingId: string;
  shopName: string;
  /** Shop signup slug; the sign-up link is omitted without one. */
  shopSlug: string | null;
  portalId: string | null;
  portalName: string | null;
  siteId: string | null;
  siteName: string | null;
}

export interface PortalPackage {
  fileName: string;
  html: string;
  /** Real measured size of the generated file — never an estimate. */
  bytes: number;
  checksum: string;
  baseVersion: number;
  baseChecksum: string;
  features: PortalTemplateFeatures;
  summary: string[];
  warnings: string[];
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}

export function buildPortalPackage(
  featuresInput: Partial<PortalTemplateFeatures> | PortalTemplateFeatures,
  binding: PortalBinding,
): PortalPackage {
  const features = normalizeTemplateFeatures(featuresInput);
  const origin = binding.origin.replace(/\/+$/, "");
  const base = baseTemplateInfo();

  const config = {
    origin,
    mappingId: binding.mappingId,
    shopName: binding.shopName,
    signupUrl: features.signUpLink && binding.shopSlug ? `${origin}/join/${binding.shopSlug}` : null,
    portalId: binding.portalId,
    siteId: binding.siteId,
    baseVersion: BASE_TEMPLATE_VERSION,
    defaultAuthType: 3,
    endpoints: base.endpoints,
    features,
  };

  const primary: string[] = [];
  if (features.buyVoucher)
    primary.push(`<a class="ww-btn ww-btn-primary" data-ww-link="buy">Buy a voucher</a>`);
  const secondary: string[] = [];
  if (features.signIn) secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="signin">Sign in</a>`);
  if (features.cashIn) secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="cashin">Cash In</a>`);
  if (features.voucherStatus)
    secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="status">Voucher status</a>`);
  if (features.showBalance || features.showPoints)
    secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="wallet">My wallet</a>`);

  const walletLine =
    features.showBalance || features.showPoints
      ? `<p class="ww-sub">Your ${[features.showBalance ? "coins" : "", features.showPoints ? "points" : ""]
          .filter(Boolean)
          .join(" and ")} are shown in WaveWallet once you open it and sign in.</p>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escapeHtml(binding.shopName)} Wi-Fi</title>
<!-- wavewallet:portal base=${BASE_TEMPLATE_VERSION} mapping=${escapeHtml(binding.mappingId)} -->
<style>${BASE_STYLE}</style>
</head>
<body>
<main class="ww-page">
  <section class="ww-card">
    <p class="ww-eyebrow">${escapeHtml(binding.shopName)} Wi-Fi</p>
    <h1 class="ww-title">Connect to the internet</h1>
    <p class="ww-sub">Enter the voucher code you already have, or get one in seconds.</p>
    ${walletLine}
    ${
      primary.length || secondary.length
        ? `<div>
      ${primary.join("\n      ")}
      ${secondary.length ? `<div class="ww-grid" style="margin-top:12px">${secondary.join("")}</div>` : ""}
    </div>`
        : ""
    }
  </section>

  <section class="ww-card">
    <p class="ww-eyebrow">Voucher</p>
    <h2 class="ww-title" style="font-size:18px">Enter your voucher code</h2>
    <form id="ww-voucher-form" novalidate>
      <label class="ww-field"><span>Voucher code</span>
        <input id="ww-voucher-code" name="voucherCode" type="text" inputmode="latin" autocomplete="one-time-code" autocapitalize="characters" required>
      </label>
      <button id="ww-voucher-submit" class="ww-btn ww-btn-connect" type="submit">Connect</button>
    </form>
    <p id="ww-msg" class="ww-msg" role="alert" hidden></p>
  </section>

  <section class="ww-card" id="ww-user" hidden>
    <p class="ww-eyebrow">Account</p>
    <h2 class="ww-title" style="font-size:18px">Sign in with your hotspot account</h2>
    <form id="ww-user-form" novalidate>
      <label class="ww-field"><span>User name</span><input id="ww-user-name" name="username" type="text" autocomplete="username"></label>
      <label class="ww-field"><span>Password</span><input id="ww-user-password" name="password" type="password" autocomplete="current-password"></label>
      <button class="ww-btn ww-btn-connect" type="submit">Connect</button>
    </form>
  </section>

  <section class="ww-card" id="ww-sms" hidden>
    <p class="ww-eyebrow">SMS</p>
    <h2 class="ww-title" style="font-size:18px">Get a code by SMS</h2>
    <form id="ww-sms-form" novalidate>
      <label class="ww-field"><span>Country code</span><input id="ww-sms-country" name="countryCode" type="text" inputmode="tel"></label>
      <label class="ww-field"><span>Mobile number</span><input id="ww-sms-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel"></label>
      <button id="ww-sms-send" class="ww-btn ww-btn-ghost" type="button">Send verification code</button>
      <label class="ww-field"><span>Verification code</span><input id="ww-sms-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"></label>
      <button class="ww-btn ww-btn-connect" type="submit">Connect</button>
    </form>
  </section>

  <section class="ww-card" id="ww-form" hidden>
    <p class="ww-eyebrow">Guest</p>
    <h2 class="ww-title" style="font-size:18px">Continue as a guest</h2>
    <form id="ww-form-form" novalidate>
      <label class="ww-field"><span>Name</span><input id="ww-form-name" name="name" type="text" autocomplete="name"></label>
      <label class="ww-field"><span>Email</span><input id="ww-form-contact" name="email" type="email" autocomplete="email"></label>
      <button id="ww-form-submit" class="ww-btn ww-btn-connect" type="submit">Connect</button>
    </form>
  </section>

  ${
    features.signUpLink
      ? `<p class="ww-foot">No account yet? <a data-ww-link="signup">Sign up with ${escapeHtml(
          binding.shopName,
        )}</a></p>`
      : ""
  }
  <p class="ww-foot">Powered by WaveWallet${
    binding.portalName ? ` &middot; ${escapeHtml(binding.portalName)}` : ""
  }</p>
</main>
<script>${BASE_SCRIPT.replace("__WW_CONFIG__", jsonForScript(config))}</script>
</body>
</html>
`;

  const warnings: string[] = [];
  if (!binding.shopSlug && features.signUpLink) {
    warnings.push("This shop has no sign-up link yet, so the sign-up line is hidden on the page.");
  }
  if (!binding.portalId) {
    warnings.push("No Omada portal id is stored on this mapping. Re-select the portal before importing.");
  }

  const summary = [
    `Manual voucher entry is always included and cannot be turned off.`,
    `Omada parameters preserved: ${baseTemplateInfo().queryParams.join(", ")}.`,
    `Omada endpoints preserved: ${Object.values(base.endpoints).join(", ")}.`,
    `Bound to ${binding.shopName} \u2192 site ${binding.siteName ?? binding.siteId ?? "unknown"} \u2192 portal ${
      binding.portalName ?? binding.portalId ?? "unknown"
    }.`,
    `Base template v${BASE_TEMPLATE_VERSION} (${base.checksum}).`,
  ];

  return {
    fileName: generatedFileName(binding.shopName, binding.portalName),
    html,
    bytes: byteSize(html),
    checksum: checksumOf(html),
    baseVersion: BASE_TEMPLATE_VERSION,
    baseChecksum: base.checksum,
    features,
    summary,
    warnings,
  };
}
