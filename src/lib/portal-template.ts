/**
 * Pure analysis + generation for Omada's "Import Customized Page" workflow.
 *
 * The canonical source is ALWAYS the original Omada template the platform owner
 * uploaded once (see portal-master.ts). This module only reads that master,
 * reports what it preserves, and produces one shop's derived page.
 *
 * Controller 6.2.14.11 exposes NO supported Open API route for uploading a
 * customized portal page, so WaveWallet never pretends to import anything: the
 * admin downloads the generated file and imports it into that exact portal.
 *
 * Everything here is pure so the admin preview and the server generator can
 * never drift apart.
 */

import {
  buildPortalThemeCss,
  defaultPortalTheme,
  THEME_DECOR_MARKUP,
  type PortalTheme,
} from "./portal-themes";

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

/** Authentication routes Omada's own template calls. Detected, never invented. */
const OMADA_ENDPOINT_PATHS = [
  "/portal/getPortalPageSetting",
  "/portal/auth",
  "/portal/radius/auth",
  "/portal/ldap/auth",
  "/portal/sendSmsAuthCode",
] as const;

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
    endpoints: [],
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

  for (const endpoint of OMADA_ENDPOINT_PATHS) {
    if (html.includes(endpoint)) analysis.endpoints.push(endpoint);
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
  // Manual voucher entry must survive. Omada masters express it either as a
  // real <form> or as a scripted submit to /portal/auth; a file with neither is
  // refused rather than silently replaced by a WaveWallet form.
  if (analysis.forms.length === 0 && analysis.endpoints.length === 0) {
    analysis.errors.push(
      "No voucher form and no Omada authentication call were found in this file, so manual voucher entry cannot be kept. Upload the original template exported from your Omada controller.",
    );
  } else if (analysis.forms.length === 0) {
    analysis.warnings.push(
      "This master submits the voucher with its own script instead of a plain form; that script is kept exactly as it is.",
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
    `Omada endpoints kept: ${analysis.endpoints.join(", ") || "none found"}.`,
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
  /** Exact Omada portal/site the generated page is bound to. */
  portalId?: string | null;
  siteId?: string | null;
  /** Canonical master this page was derived from. */
  masterVersion?: number;
  masterChecksum?: string;
  /** Presentation only. Omitted means the default gallery theme. */
  theme?: PortalTheme;
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

/* The presentation layer lives in portal-themes.ts. It only ever changes how
   the page looks: the markup slots, the moved-in Omada form and every runtime
   behaviour below are identical for every theme. */


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
  const theme = ctx.theme ?? defaultPortalTheme();
  const config = {
    origin,
    portalUrl: `${origin}/portal`,
    mappingId: ctx.mappingId,
    shopName: ctx.shopName,
    signupUrl: ctx.shopSlug ? `${origin}/join/${ctx.shopSlug}` : null,
    features,
    theme: theme.slug,
    portalId: ctx.portalId ?? null,
    siteId: ctx.siteId ?? null,
    masterVersion: ctx.masterVersion ?? null,
    /** Only parameter names the canonical master actually referenced. */
    params: analysis.omadaParameters,
    /** Only endpoints the canonical master actually calls. */
    endpoints: analysis.endpoints,
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
<!-- canonical master v${ctx.masterVersion ?? 0} ${escapeHtml(ctx.masterChecksum ?? "unknown")} · site ${escapeHtml(
    ctx.siteId ?? ctx.siteName ?? "",
  )} · portal ${escapeHtml(ctx.portalId ?? ctx.portalName ?? "")} · theme ${escapeHtml(theme.slug)} -->
<style id="ww-portal-style">${buildPortalThemeCss(theme)}</style>
<div id="ww-portal" data-ww-theme="${escapeHtml(theme.slug)}">
  ${THEME_DECOR_MARKUP}
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
      <p class="ww-eyebrow" data-ww-auth-eyebrow>Already have a code?</p>
      <h2 class="ww-title" style="font-size:18px" data-ww-auth-title>Enter your voucher</h2>
      <div class="ww-seg" data-ww-methods role="tablist" hidden></div>
      <div class="ww-slot" id="ww-voucher-slot">
        <p class="ww-sub" data-ww-slot-fallback>Use the hotspot login form on this page to enter your code.</p>
      </div>
      <div class="ww-slot" id="ww-auth-action"></div>
      <p class="ww-error" data-ww-error hidden></p>
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

  /* Manual voucher entry: MOVE the controller's own form, never rebuild it.
     Everything below relocates and restyles Omada's REAL controls. No form,
     field, handler or endpoint is recreated, so submitting always runs the
     controller's own authentication. */
  var authSlot = document.getElementById("ww-auth-action");
  var errorEl = root.querySelector("[data-ww-error]");
  var segEl = root.querySelector("[data-ww-methods]");
  var titleEl = root.querySelector("[data-ww-auth-title]");
  var eyebrowEl = root.querySelector("[data-ww-auth-eyebrow]");
  var loginControl = null;

  try {
    var slot = document.getElementById("ww-voucher-slot");
    var forms = document.querySelectorAll("form");
    var chosen = null;
    for (var f=0;f<forms.length;f++){
      if (root.contains(forms[f])) continue;
      chosen = forms[f];
      break;
    }
    if (!chosen){
      /* Masters that submit with their own script: move the field the master
         uses for the voucher code, together with its container. */
      var field = document.querySelector("input[name*=voucher i],input[id*=voucher i],input[name*=code i],input[id*=code i]");
      if (field && !root.contains(field)) chosen = field.closest("div,section,fieldset") || field;
    }
    if (chosen && slot){
      var fallback = slot.querySelector("[data-ww-slot-fallback]");
      if (fallback) fallback.parentNode.removeChild(fallback);
      slot.appendChild(chosen);
    }
  } catch (e) { /* template keeps its own layout */ }

  /* The master's own submit control, moved (never rebuilt) under the fields. */
  try {
    var control = document.querySelector("#button-login,#button-area button,#button-area a,button[type=submit],input[type=submit]");
    if (control && !root.contains(control) && authSlot){
      var holder = control.id === "button-login" ? (document.getElementById("button-area") || control) : control;
      authSlot.appendChild(holder);
      loginControl = control;
    }
  } catch (e) {}

  /* Omada's own presentation is hidden, never deleted: every node stays in the
     document so the controller's scripts and handlers keep working. */
  function hideOmadaChrome(){
    if (!document.body) return;
    var kids = document.body.children;
    for (var i=0;i<kids.length;i++){
      var el = kids[i];
      if (el === root || el.id === "ww-portal") continue;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;
      if (el.classList && !el.classList.contains("ww-omada-off")) el.classList.add("ww-omada-off");
    }
  }

  function isVisible(el){
    if (!el) return false;
    if (el.classList && el.classList.contains("hidden")) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  }

  function fieldVisible(selector){
    var el = document.querySelector(selector);
    if (!el || !root.contains(el)) return false;
    var node = el;
    while (node && node !== root){
      if (!isVisible(node)) return false;
      node = node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null;
    }
    return true;
  }

  /* Which method is on screen right now, read from the controller's own
     fields — never assumed, never hard-coded. */
  function currentMethod(){
    if (fieldVisible("input[name=voucherCode],#voucherCode")) return "voucher";
    if (fieldVisible("input[name=username],#username")) return "user";
    if (fieldVisible("input[name=phone-number],#phone-number")) return "phone";
    if (fieldVisible("input[name=simplePassword],#simplePassword")) return "simple";
    return "";
  }

  /* Every field the controller ships for a given method. Local User is the
     controller's own username AND password input — both are required, so both
     are shown together. Nothing here creates a field: each one must already
     exist in the master, otherwise that method simply has no panel. */
  var PANEL_FIELDS = {
    voucher: ["voucherCode"],
    user: ["username", "password"],
    simple: ["simplePassword"],
    phone: ["country-code", "phone-number", "verify-code"]
  };

  function fieldEl(name){
    return root.querySelector("[name='" + name + "']") || root.querySelector("#" + name);
  }

  function panelBox(el){
    var node = el;
    while (node && node !== root){
      if (node.classList && node.classList.contains("input-container")) return node;
      var parent = node.parentNode;
      if (!parent || parent === root || (parent.tagName && parent.tagName === "FORM")) return node;
      node = parent;
    }
    return el;
  }

  var activeKind = "";

  /* Presentation only: the controller keeps its own classes and handlers, we
     only decide which of ITS containers the customer can see. */
  function applyPanels(){
    if (!activeKind) return;
    for (var kind in PANEL_FIELDS){
      if (!Object.prototype.hasOwnProperty.call(PANEL_FIELDS, kind)) continue;
      var on = kind === activeKind;
      var names = PANEL_FIELDS[kind];
      for (var i=0;i<names.length;i++){
        var el = fieldEl(names[i]);
        if (!el) continue;
        var box = panelBox(el);
        if (!box || !box.classList) continue;
        box.classList.remove(on ? "ww-off" : "ww-on");
        if (!box.classList.contains(on ? "ww-on" : "ww-off")) box.classList.add(on ? "ww-on" : "ww-off");
        if (on && box.style && box.style.display === "none") box.style.display = "";
      }
    }
  }

  var LABELS = {
    voucher: { eyebrow: "Already have a code?", title: "Enter your voucher", action: "Connect with Voucher" },
    user: { eyebrow: "Hotspot account", title: "Sign in with your username", action: "Sign in" },
    phone: { eyebrow: "Hotspot account", title: "Verify your number", action: "Connect" },
    simple: { eyebrow: "Hotspot access", title: "Enter the Wi-Fi key", action: "Connect" }
  };

  function syncLabels(){
    var m = activeKind || currentMethod();
    var copy = LABELS[m] || LABELS.voucher;
    if (eyebrowEl && eyebrowEl.textContent !== copy.eyebrow) eyebrowEl.textContent = copy.eyebrow;
    if (titleEl && titleEl.textContent !== copy.title) titleEl.textContent = copy.title;
    if (loginControl && loginControl.textContent !== copy.action) loginControl.textContent = copy.action;
    if (segEl){
      var segs = segEl.querySelectorAll("button[data-ww-method]");
      for (var i=0;i<segs.length;i++){
        var want = segs[i].getAttribute("data-ww-method") === m ? "true" : "false";
        if (segs[i].getAttribute("aria-selected") !== want) segs[i].setAttribute("aria-selected", want);
      }
    }
  }

  /* Available methods come from the controller's own "Other Login Methods"
     list, so only what THIS portal enables can ever appear. */
  function methodKind(label){
    var t = (label || "").toLowerCase();
    if (t.indexOf("voucher") !== -1) return "voucher";
    if (t.indexOf("local user") !== -1 || t.indexOf("user") !== -1) return "user";
    if (t.indexOf("sms") !== -1 || t.indexOf("phone") !== -1) return "phone";
    if (t.indexOf("password") !== -1) return "simple";
    return "";
  }

  function selectorOptions(){
    var box = document.getElementById("hotspot-selector");
    if (!box) return [];
    var nodes = box.querySelectorAll("li,a,button,[data-type],[data-authtype],div");
    var found = [];
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i];
      if (n.id === "hotspot-selector-close") continue;
      if (n.className && String(n.className).indexOf("title") !== -1) continue;
      if (n.parentNode && n.parentNode.className && String(n.parentNode.className).indexOf("title") !== -1) continue;
      var text = (n.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text || text.length > 40) continue;
      var kind = methodKind(text);
      if (!kind) continue;
      var nested = false;
      for (var j=0;j<found.length;j++){
        if (found[j].el.contains(n)){ found[j] = { label: text, el: n, kind: kind }; nested = true; break; }
        if (n.contains(found[j].el)){ nested = true; break; }
      }
      if (!nested) found.push({ label: text, el: n, kind: kind });
    }
    var seen = {};
    var unique = [];
    for (var k=0;k<found.length;k++){
      if (seen[found[k].kind]) continue;
      seen[found[k].kind] = true;
      unique.push(found[k]);
    }
    unique.sort(function(a,b){ return (a.kind === "voucher" ? 0 : 1) - (b.kind === "voucher" ? 0 : 1); });
    return unique;
  }

  var renderedMethods = "";
  var defaulted = false;

  function closeSelector(){
    var close = document.getElementById("hotspot-selector-close");
    if (close && close.click) { try { close.click(); } catch (e) {} }
    var box = document.getElementById("hotspot-selector");
    if (box && box.classList) box.classList.add("ww-omada-off");
  }

  function chooseMethod(option){
    activeKind = option.kind;
    /* Same page, real runtime: this clicks the controller's own method item so
       Omada switches its authentication type before anything is submitted. */
    try { option.el.click(); } catch (e) {}
    closeSelector();
    hideOmadaChrome();
    applyPanels();
    syncLabels();
    setTimeout(function(){ applyPanels(); syncLabels(); }, 0);
    setTimeout(function(){ applyPanels(); syncLabels(); }, 150);
  }

  function renderMethods(){
    if (!segEl) return;
    var options = selectorOptions();
    var signature = options.map(function(o){ return o.kind + ":" + o.label; }).join("|");
    if (signature !== renderedMethods){
      renderedMethods = signature;
      segEl.innerHTML = "";
      if (options.length > 1){
        for (var i=0;i<options.length;i++){
          (function(option){
            var btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("data-ww-method", option.kind);
            btn.setAttribute("role", "tab");
            btn.setAttribute("aria-selected", "false");
            btn.textContent = option.kind === "user" ? "Local User" : option.label;
            btn.onclick = function(){ chooseMethod(option); };
            segEl.appendChild(btn);
          })(options[i]);
        }
        segEl.removeAttribute("hidden");
      } else {
        segEl.setAttribute("hidden", "hidden");
      }
    }
    if (!defaulted){
      if (options.length > 1){
        /* Voucher first when the controller offers it, otherwise the single
           method this portal actually enables. */
        var pick = null;
        for (var v=0;v<options.length;v++){
          if (options[v].kind === "voucher"){ pick = options[v]; break; }
        }
        if (!pick && currentMethod()){
          for (var w=0;w<options.length;w++){
            if (options[w].kind === currentMethod()){ pick = options[w]; break; }
          }
        }
        if (!pick) pick = options[0];
        defaulted = true;
        chooseMethod(pick);
      } else if (options.length === 1){
        defaulted = true;
        activeKind = options[0].kind;
        applyPanels();
      } else if (!activeKind){
        /* No selector at all: this portal enables exactly one method and the
           controller already put its own field on screen. */
        activeKind = currentMethod();
        if (activeKind) applyPanels();
      }
    }
  }

  /* Controller error text is shown inside the WaveWallet card instead of the
     raw Omada hint, which stays in the document but out of sight. */
  function mirrorErrors(){
    if (!errorEl) return;
    var sources = ["#oper-hint", "#form-auth-note", "#form-auth-title"];
    var message = "";
    for (var i=0;i<sources.length && !message;i++){
      var el = document.querySelector(sources[i]);
      if (el && !root.contains(el)) message = (el.textContent || "").replace(/\\s+/g, " ").trim();
    }
    if (message){
      if (errorEl.textContent !== message) errorEl.textContent = message;
      if (errorEl.hasAttribute("hidden")) errorEl.removeAttribute("hidden");
    } else {
      if (errorEl.textContent !== "") errorEl.textContent = "";
      if (!errorEl.hasAttribute("hidden")) errorEl.setAttribute("hidden", "hidden");
    }
  }

  var syncing = false;
  function sync(){
    if (syncing) return;
    syncing = true;
    try {
      hideOmadaChrome();
      renderMethods();
      syncLabels();
      mirrorErrors();
    } catch (e) {}
    syncing = false;
  }
  sync();

  try {
    var observer = new MutationObserver(function(){
      if (syncing) return;
      sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"], characterData: true });
  } catch (e) {}
  var ticks = 0;
  var timer = setInterval(function(){ ticks += 1; sync(); if (ticks > 40) clearInterval(timer); }, 500);


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
