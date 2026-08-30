/**
 * Omada "Import Customized Page" workflow for ONE shop's own portal.
 *
 * Controller 6.2.14.11 exposes NO supported Open API route for uploading a
 * customized portal page (every documented and probed path answers 404 or the
 * generic "invalid request parameters" catch-all), so WaveWallet never pretends
 * to import anything. Instead the admin uploads the template their OWN
 * controller produced, WaveWallet analyses it, keeps every Omada mechanic it
 * finds and appends its own UI, and the admin uploads the generated file back
 * into that exact portal.
 *
 * Everything in this module is pure so the admin preview and the server
 * generator can never drift apart.
 */

/* ------------------------------------------------------------------ *
 * Features                                                            *
 * ------------------------------------------------------------------ */

export interface PortalTemplateFeatures {
  /** Always on: the Omada voucher form itself is never removed. */
  manualVoucher: true;
  buyVoucher: boolean;
  signIn: boolean;
  showBalance: boolean;
  showPoints: boolean;
  cashIn: boolean;
  voucherStatus: boolean;
  signUpLink: boolean;
}

export const DEFAULT_TEMPLATE_FEATURES: PortalTemplateFeatures = {
  manualVoucher: true,
  buyVoucher: true,
  signIn: true,
  showBalance: true,
  showPoints: true,
  cashIn: false,
  voucherStatus: true,
  signUpLink: true,
};

export const TEMPLATE_FEATURE_LABELS: Array<{
  key: keyof PortalTemplateFeatures;
  label: string;
  hint: string;
  locked?: boolean;
}> = [
  {
    key: "manualVoucher",
    label: "Manual voucher entry",
    hint: "The controller's own voucher form. Always kept, exactly as Omada built it.",
    locked: true,
  },
  {
    key: "buyVoucher",
    label: "Buy a voucher",
    hint: "Opens this shop's existing Voucher Shop inside the WaveWallet portal page.",
  },
  { key: "signIn", label: "Sign in / remembered customer", hint: "Greets a known customer by name." },
  { key: "showBalance", label: "Show coin balance", hint: "The customer's real wallet balance." },
  { key: "showPoints", label: "Show points balance", hint: "The customer's real reward points." },
  { key: "cashIn", label: "Cash In", hint: "Links to this shop's existing Cash In flow." },
  { key: "voucherStatus", label: "Voucher status", hint: "Check a code the customer already holds." },
  {
    key: "signUpLink",
    label: "Sign-up link",
    hint: "\u201cNo account yet?\u201d using this shop's own signup link.",
  },
];

export function normalizeTemplateFeatures(value: unknown): PortalTemplateFeatures {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = (key: keyof PortalTemplateFeatures) =>
    typeof raw[key] === "boolean"
      ? (raw[key] as boolean)
      : (DEFAULT_TEMPLATE_FEATURES[key] as boolean);
  return {
    manualVoucher: true,
    buyVoucher: pick("buyVoucher"),
    signIn: pick("signIn"),
    showBalance: pick("showBalance"),
    showPoints: pick("showPoints"),
    cashIn: pick("cashIn"),
    voucherStatus: pick("voucherStatus"),
    signUpLink: pick("signUpLink"),
  };
}

/* ------------------------------------------------------------------ *
 * Template analysis                                                   *
 * ------------------------------------------------------------------ */

export interface TemplateForm {
  action: string | null;
  method: string;
  hiddenFields: string[];
  inputs: string[];
}

export interface TemplateAnalysis {
  /** Safe to generate from. */
  valid: boolean;
  bytes: number;
  hasHtmlShell: boolean;
  hasBodyClose: boolean;
  forms: TemplateForm[];
  /** Names of Omada context parameters the template itself references. */
  omadaParameters: string[];
  /** Template placeholders left untouched by the generator. */
  placeholders: string[];
  scriptSources: string[];
  inlineScripts: number;
  /** Omada authentication endpoints the master itself calls. */
  endpoints: string[];
  /** Everything preserved, phrased for the admin. */
  preserved: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Context names Omada itself uses in its downloadable portal template. Only
 * these are looked for — nothing is invented, and a name that is not present in
 * the uploaded template is never added to the generated page.
 */
const OMADA_PARAM_NAMES = [
  "clientMac",
  "apMac",
  "ssidName",
  "radioId",
  "vid",
  "originUrl",
  "redirectUrl",
  "submitUrl",
  "site",
  "siteId",
  "portalId",
  "authType",
  "t",
  "clientIp",
  "gatewayMac",
] as const;

const MARKER = "<!-- wavewallet:portal -->";

function matchAll(html: string, re: RegExp): RegExpMatchArray[] {
  return Array.from(html.matchAll(re));
}

/** Reads one uploaded Omada template without changing a single byte of it. */
export function analyzeOmadaTemplate(html: string): TemplateAnalysis {
  const analysis: TemplateAnalysis = {
    valid: false,
    bytes: new TextEncoder().encode(html).length,
    hasHtmlShell: /<html[\s>]/i.test(html),
    hasBodyClose: /<\/body\s*>/i.test(html),
    forms: [],
    omadaParameters: [],
    placeholders: [],
    scriptSources: [],
    inlineScripts: 0,
    preserved: [],
    warnings: [],
    errors: [],
  };

  if (!html.trim()) {
    analysis.errors.push("The uploaded file is empty.");
    return analysis;
  }
  if (analysis.bytes > 2_000_000) {
    analysis.errors.push("The uploaded file is larger than 2 MB. Upload the portal page only.");
    return analysis;
  }
  if (!/<[a-z!]/i.test(html)) {
    analysis.errors.push("This file does not look like an HTML page.");
    return analysis;
  }

  for (const m of matchAll(html, /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "get").toUpperCase();
    const hiddenFields: string[] = [];
    const inputs: string[] = [];
    for (const i of matchAll(inner, /<input\b([^>]*)>/gi)) {
      const a = i[1] ?? "";
      const name = /name\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? "";
      if (!name) continue;
      if (/type\s*=\s*["']hidden["']/i.test(a)) hiddenFields.push(name);
      else inputs.push(name);
    }
    analysis.forms.push({ action, method, hiddenFields, inputs });
  }

  for (const name of OMADA_PARAM_NAMES) {
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(html)) analysis.omadaParameters.push(name);
  }

  const placeholders = new Set<string>();
  for (const m of matchAll(html, /\{\{\s*[\w.$-]+\s*\}\}/g)) placeholders.add(m[0]!.trim());
  for (const m of matchAll(html, /<%=?[\s\S]{1,60}?%>/g)) placeholders.add(m[0]!.trim());
  analysis.placeholders = Array.from(placeholders).slice(0, 40);

  for (const m of matchAll(html, /<script\b([^>]*)>/gi)) {
    const src = /src\s*=\s*["']([^"']*)["']/i.exec(m[1] ?? "")?.[1];
    if (src) analysis.scriptSources.push(src);
    else analysis.inlineScripts += 1;
  }

  if (html.includes(MARKER)) {
    analysis.errors.push(
      "This file was already generated by WaveWallet. Upload the ORIGINAL template exported from your Omada controller.",
    );
  }
  if (!analysis.hasBodyClose) {
    analysis.warnings.push(
      "No closing </body> tag was found; the WaveWallet section will be appended at the end of the file instead.",
    );
  }
  // Manual voucher entry must survive, so a template without the controller's
  // own form is refused rather than silently replaced by a WaveWallet form.
  if (analysis.forms.length === 0) {
    analysis.errors.push(
      "No form was found in this template, so manual voucher entry cannot be kept. Export the template again from the portal that uses voucher authentication.",
    );
  }
  if (analysis.omadaParameters.length === 0) {
    analysis.warnings.push(
      "No Omada client parameters were found in this template. The generated page will still read whatever the controller puts in the page address.",
    );
  }

  analysis.preserved = [
    `${analysis.forms.length} Omada form(s) kept with their original action, method and handlers.`,
    `${analysis.forms.reduce((n, f) => n + f.hiddenFields.length, 0)} hidden field(s) kept: ${
      analysis.forms.flatMap((f) => f.hiddenFields).join(", ") || "none found"
    }.`,
    `${analysis.scriptSources.length} controller script file(s) and ${analysis.inlineScripts} inline script block(s) kept untouched.`,
    `${analysis.placeholders.length} template placeholder(s) kept verbatim.`,
    `Omada parameters detected: ${analysis.omadaParameters.join(", ") || "none"}.`,
  ];

  analysis.valid = analysis.errors.length === 0;
  return analysis;
}

/* ------------------------------------------------------------------ *
 * Generation                                                          *
 * ------------------------------------------------------------------ */

export interface GenerateContext {
  /** Deployed WaveWallet origin, e.g. https://wallet.example.com */
  origin: string;
  /** The exact saved mapping this portal is bound to. */
  mappingId: string;
  shopName: string;
  /** Shop signup slug; the sign-up link is omitted when absent. */
  shopSlug: string | null;
  portalName: string | null;
  siteName: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe to embed inside a <script> block. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}

const STYLE = `
:root{--ww-ink:#0b1729;--ww-muted:#5b6b84;--ww-brand:#1d6ef5;--ww-accent:#12b26a;}
#ww-portal *{box-sizing:border-box}
#ww-portal{position:relative;margin:0;padding:20px 16px 40px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ww-ink);background:linear-gradient(160deg,#eaf1ff 0%,#f7fbff 45%,#eafaf3 100%);overflow:hidden}
#ww-portal:before,#ww-portal:after{content:"";position:absolute;border-radius:50%;filter:blur(46px);opacity:.5;pointer-events:none}
#ww-portal:before{width:280px;height:280px;top:-120px;right:-90px;background:radial-gradient(circle,#4f8cff,#8ad6ff)}
#ww-portal:after{width:260px;height:260px;bottom:-130px;left:-100px;background:radial-gradient(circle,#4ce0a5,#bff5dd)}
.ww-wrap{position:relative;max-width:520px;margin:0 auto;display:grid;gap:14px}
.ww-card{background:rgba(255,255,255,.78);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.85);border-radius:20px;padding:18px;box-shadow:0 18px 40px -24px rgba(12,32,64,.45)}
.ww-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ww-muted);margin:0 0 6px}
.ww-title{font-size:22px;line-height:1.2;font-weight:700;margin:0 0 6px}
.ww-sub{font-size:14px;color:var(--ww-muted);margin:0}
.ww-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
.ww-stat{border-radius:14px;padding:10px 12px;background:linear-gradient(135deg,rgba(29,110,245,.10),rgba(18,178,106,.10))}
.ww-stat b{display:block;font-size:18px}
.ww-stat span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ww-muted)}
.ww-actions{display:grid;gap:10px;margin-top:14px}
.ww-btn{display:block;width:100%;text-align:center;text-decoration:none;font-weight:600;font-size:15px;padding:13px 16px;border-radius:14px;border:1px solid transparent;cursor:pointer}
.ww-btn-primary{background:linear-gradient(135deg,var(--ww-brand),#0d47b5);color:#fff;box-shadow:0 12px 22px -14px rgba(13,71,181,.9)}
.ww-btn-ghost{background:rgba(255,255,255,.7);border-color:rgba(11,23,41,.10);color:var(--ww-ink)}
.ww-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ww-slot{margin-top:6px}
.ww-slot form{margin:0}
.ww-slot input[type=text],.ww-slot input[type=password],.ww-slot input:not([type]){width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(11,23,41,.14);font-size:16px;background:#fff}
.ww-slot button,.ww-slot input[type=submit],.ww-slot input[type=button]{width:100%;margin-top:10px;padding:13px 16px;border-radius:14px;border:0;background:linear-gradient(135deg,var(--ww-accent),#0b8f53);color:#fff;font-size:15px;font-weight:600}
.ww-foot{text-align:center;font-size:12px;color:var(--ww-muted)}
.ww-foot a{color:var(--ww-brand);font-weight:600}
@media (min-width:560px){.ww-title{font-size:26px}}
`.trim();

/**
 * Builds the page the admin uploads into Omada's "Import Customized Page".
 *
 * The uploaded template is emitted BYTE-FOR-BYTE; WaveWallet only inserts its
 * own section (and moves the controller's real login form into that section at
 * runtime, without recreating it, so every Omada handler and hidden field stays
 * attached).
 */
export function generateWaveWalletPortal(
  template: string,
  analysis: TemplateAnalysis,
  features: PortalTemplateFeatures,
  ctx: GenerateContext,
): string {
  const origin = ctx.origin.replace(/\/+$/, "");
  const config = {
    origin,
    portalUrl: `${origin}/portal`,
    mappingId: ctx.mappingId,
    shopName: ctx.shopName,
    signupUrl: ctx.shopSlug ? `${origin}/join/${ctx.shopSlug}` : null,
    features,
    /** Only parameter names the uploaded template actually referenced. */
    params: analysis.omadaParameters,
  };


  const buttons: string[] = [];
  if (features.buyVoucher)
    buttons.push(`<a class="ww-btn ww-btn-primary" data-ww-link="buy">Buy a voucher</a>`);
  const secondary: string[] = [];
  if (features.cashIn) secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="cashin">Cash In</a>`);
  if (features.voucherStatus)
    secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="status">Voucher status</a>`);
  if (features.signIn)
    secondary.push(`<a class="ww-btn ww-btn-ghost" data-ww-link="signin">Sign in</a>`);

  const section = `
${MARKER}
<style id="ww-portal-style">${STYLE}</style>
<div id="ww-portal">
  <div class="ww-wrap">
    <section class="ww-card">
      <p class="ww-eyebrow">${escapeHtml(ctx.shopName)} Wi-Fi</p>
      <h1 class="ww-title" data-ww-greeting>Buy a voucher to resume internet</h1>
      <p class="ww-sub" data-ww-sub>Enter the voucher code you already have, or get one in seconds.</p>
      <p class="ww-sub" data-ww-status hidden></p>${
        features.showBalance || features.showPoints
          ? `\n      <p class="ww-sub">Your ${[
              features.showBalance ? "coins" : "",
              features.showPoints ? "points" : "",
            ]
              .filter(Boolean)
              .join(" and ")} and your name appear once you open WaveWallet below.</p>`
          : ""
      }
      <div class="ww-actions">
        ${buttons.join("\n        ")}
        ${secondary.length ? `<div class="ww-grid">${secondary.join("")}</div>` : ""}
      </div>
    </section>

    <section class="ww-card">
      <p class="ww-eyebrow">Already have a code?</p>
      <h2 class="ww-title" style="font-size:18px">Enter your voucher</h2>
      <div class="ww-slot" id="ww-voucher-slot">
        <p class="ww-sub" data-ww-slot-fallback>Use the hotspot login form on this page to enter your code.</p>
      </div>
    </section>

    ${
      features.signUpLink
        ? `<p class="ww-foot" data-ww-signup hidden>No account yet? <a data-ww-link="signup">Sign up with ${escapeHtml(
            ctx.shopName,
          )}</a></p>`
        : ""
    }
    <p class="ww-foot">Powered by WaveWallet${
      ctx.portalName ? ` &middot; ${escapeHtml(ctx.portalName)}` : ""
    }</p>
  </div>
</div>
<script id="ww-portal-script">
(function(){
  var CFG = ${jsonForScript(config)};
  var root = document.getElementById("ww-portal");
  if (!root) return;

  /* Omada context: only what the controller itself put in the address bar or
     in the template's own hidden fields. Nothing is invented. */
  function context(){
    var out = {};
    try {
      var q = new URLSearchParams(window.location.search);
      q.forEach(function(v,k){ if (v) out[k] = v; });
    } catch (e) {}
    try {
      var hidden = document.querySelectorAll("input[type=hidden][name]");
      for (var i=0;i<hidden.length;i++){
        var n = hidden[i].getAttribute("name");
        var v = hidden[i].value;
        if (n && v && out[n] === undefined) out[n] = v;
      }
    } catch (e) {}
    return out;
  }

  var SESSION = null;

  function link(path){
    var url = CFG.origin + path;
    var join = url.indexOf("?") === -1 ? "?" : "&";
    var parts = ["wwPortal=" + encodeURIComponent(CFG.mappingId)];
    if (SESSION) parts.push("wwSession=" + encodeURIComponent(SESSION));
    var ctx = context();
    for (var k in ctx){
      if (!Object.prototype.hasOwnProperty.call(ctx,k)) continue;
      if (k === "wwPortal" || k === "wwSession") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(ctx[k]));
    }
    return url + join + parts.join("&");
  }

  var intents = { buy: "buy", cashin: "cashin", status: "status", signin: "signin" };

  function applyLinks(){
    var anchors = root.querySelectorAll("[data-ww-link]");
    for (var a=0;a<anchors.length;a++){
      var el = anchors[a];
      var kind = el.getAttribute("data-ww-link");
      if (kind === "signup"){
        var wrap = el.parentNode;
        if (!CFG.signupUrl){ if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap); continue; }
        el.setAttribute("href", CFG.signupUrl);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
        if (wrap && wrap.removeAttribute) wrap.removeAttribute("hidden");
        continue;
      }
      var href = link("/portal");
      if (intents[kind]) href += "&wwIntent=" + intents[kind];
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener");
    }
  }
  applyLinks();

  /* Manual voucher entry: MOVE the controller's own form, never rebuild it. */
  try {
    var slot = document.getElementById("ww-voucher-slot");
    var forms = document.querySelectorAll("form");
    var chosen = null;
    for (var f=0;f<forms.length;f++){
      if (root.contains(forms[f])) continue;
      chosen = forms[f];
      break;
    }
    if (chosen && slot){
      var fallback = slot.querySelector("[data-ww-slot-fallback]");
      if (fallback) fallback.parentNode.removeChild(fallback);
      slot.appendChild(chosen);
    }
  } catch (e) { /* template keeps its own layout */ }

  /* Hands the Omada client context to WaveWallet, which validates the portal
     binding server-side and answers with a short-lived hotspot session id. No
     balance and no customer detail is ever returned to this page: personal
     information only appears in WaveWallet itself, after the customer signs in.
     A captive portal that blocks outside calls simply keeps the static page. */
  try {
    fetch(CFG.origin + "/api/public/portal-context", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappingId: CFG.mappingId, context: context() })
    })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if (!d || !d.ok) return;
        SESSION = d.sessionId || null;
        applyLinks();
        var status = root.querySelector("[data-ww-status]");
        if (status && d.shopName){
          status.textContent = "Connected to " + d.shopName + ".";
          status.removeAttribute("hidden");
        }
      })
      .catch(function(){ /* offline captive portal: stay static */ });
  } catch (e) {}
})();
</script>
`;

  if (analysis.hasBodyClose) {
    return template.replace(/<\/body\s*>/i, (m) => `${section}\n${m}`);
  }
  return `${template}\n${section}`;
}

/** File name offered to the admin; never contains anything secret. */
export function generatedFileName(shopName: string, portalName: string | null): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  const parts = [slug(shopName) || "wavewallet", portalName ? slug(portalName) : ""].filter(Boolean);
  return `${parts.join("-")}-portal.html`;
}

/* ------------------------------------------------------------------ *
 * Wizard state                                                        *
 * ------------------------------------------------------------------ */

export type TemplateStage = "controller" | "portal" | "features" | "generate" | "import";

export interface TemplateProgress {
  controllerConnected: boolean;
  portalSelected: boolean;
  featuresChosen: boolean;
  generated: boolean;
  /** Only true when a read-back actually proved it. Never on an attempt. */
  importedVerified: boolean;
}

export function templateStage(p: TemplateProgress): TemplateStage {
  if (!p.controllerConnected) return "controller";
  if (!p.portalSelected) return "portal";
  if (!p.featuresChosen) return "features";
  if (!p.generated) return "generate";
  return p.importedVerified ? "import" : "generate";
}
