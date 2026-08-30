/**
 * WaveWallet Base Template for Omada's "Import Customized Page" workflow.
 *
 * The canonical master is the ORIGINAL Omada customized-portal download
 * (index.html + index.css + index.js + jquery.min.js + logo.png +
 * background.png + background_mobile.png + img assets). That master is kept
 * unchanged as the reference source; nothing in this module rewrites it.
 *
 * What this module does instead is derive ONE lightweight base template from
 * the master's audited runtime contract, so neither the platform owner nor the
 * shop admin ever has to upload a template. Every Omada mechanic listed in
 * OMADA_RUNTIME_AUDIT below is reproduced exactly:
 *
 *  - the query parameters the master reads on load;
 *  - the POST to /portal/getPortalPageSetting and how its answer drives the UI;
 *  - the auth endpoints and payloads per auth type;
 *  - the SMS code request;
 *  - the controller error codes; and
 *  - the landing-url redirect on success.
 *
 * Only presentation is replaced: no Omada background image, no logo, no image
 * assets, no jQuery (the master's jQuery usage is DOM/ajax only, so it is
 * replaced one-for-one with vanilla DOM + fetch), no external fonts.
 */

/* ------------------------------------------------------------------ *
 * Audit of the canonical master's index.js                            *
 * ------------------------------------------------------------------ */

export type RuntimeClass = "omada-core" | "omada-auth-type" | "ui-only" | "safe-to-remove";

export interface RuntimeAuditEntry {
  name: string;
  classification: RuntimeClass;
  /** Kept in the generated portal? Everything but safe-to-remove/ui-only is. */
  preserved: boolean;
  note: string;
}

export const OMADA_RUNTIME_AUDIT: RuntimeAuditEntry[] = [
  {
    name: "read query parameters (clientMac, apMac, gatewayMac, ssidName, radioId, vid, originUrl, previewSite)",
    classification: "omada-core",
    preserved: true,
    note: "Client context the controller puts in the page address. Read on load, echoed in every request.",
  },
  {
    name: "POST /portal/getPortalPageSetting",
    classification: "omada-core",
    preserved: true,
    note: "First call. Its answer supplies authType, hotspot.enabledTypes, portalCustomize button text, formAuth and sms.countryCode.",
  },
  {
    name: "POST /portal/auth",
    classification: "omada-core",
    preserved: true,
    note: "Standard authentication for voucher, local user, SMS and form auth.",
  },
  {
    name: "POST /portal/radius/auth",
    classification: "omada-auth-type",
    preserved: true,
    note: "RADIUS / external RADIUS authentication endpoint.",
  },
  {
    name: "POST /portal/ldap/auth",
    classification: "omada-auth-type",
    preserved: true,
    note: "External LDAP authentication endpoint.",
  },
  {
    name: "POST /portal/sendSmsAuthCode",
    classification: "omada-auth-type",
    preserved: true,
    note: "Requests the SMS verification code before /portal/auth.",
  },
  {
    name: "landing redirect (window.location.href = landingUrl/result)",
    classification: "omada-core",
    preserved: true,
    note: "Sends the client onwards once the controller accepts the login.",
  },
  {
    name: "controller error-code mapping (-41500 .. -41538)",
    classification: "omada-core",
    preserved: true,
    note: "Every returned errorCode is turned into a customer-readable message.",
  },
  {
    name: "jQuery ($.ajax, $(selector), .html(), .show()/.hide())",
    classification: "safe-to-remove",
    preserved: false,
    note: "Only DOM and ajax helpers were used, replaced one-for-one with fetch and vanilla DOM. No Omada behaviour depends on jQuery.",
  },
  {
    name: "background.png / background_mobile.png / logo.png / img assets",
    classification: "ui-only",
    preserved: false,
    note: "Presentation only. Replaced by a CSS-only premium background with no external requests.",
  },
  {
    name: "Omada stock stylesheet (index.css) and its theme switches",
    classification: "ui-only",
    preserved: false,
    note: "Replaced by the WaveWallet inline stylesheet. No behaviour attached.",
  },
];

/** Omada authentication type ids read from getPortalPageSetting. */
export const OMADA_AUTH_TYPES = {
  externalRadius: 2,
  voucher: 3,
  localUser: 5,
  sms: 6,
  radius: 8,
  formAuth: 12,
  externalLdap: 15,
} as const;

/** Query parameters the master reads on initial load. */
export const OMADA_QUERY_PARAMS = [
  "clientMac",
  "apMac",
  "gatewayMac",
  "ssidName",
  "radioId",
  "vid",
  "originUrl",
  "previewSite",
] as const;

/** Endpoints the master calls. */
export const OMADA_ENDPOINTS = {
  pageSetting: "/portal/getPortalPageSetting",
  auth: "/portal/auth",
  radiusAuth: "/portal/radius/auth",
  ldapAuth: "/portal/ldap/auth",
  sendSmsAuthCode: "/portal/sendSmsAuthCode",
} as const;

/** Lowest and highest controller error codes the master handles. */
export const OMADA_ERROR_CODE_RANGE = { first: -41538, last: -41500 } as const;

/** Bumped whenever the derived base template changes shape. */
export const BASE_TEMPLATE_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Deterministic checksum                                              *
 * ------------------------------------------------------------------ */

/** FNV-1a, 64-bit, hex. Stable across runtimes; used only as a fingerprint. */
export function checksumOf(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(value);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function byteSize(value: string): number {
  return new TextEncoder().encode(value).length;
}

/* ------------------------------------------------------------------ *
 * The base template                                                   *
 * ------------------------------------------------------------------ */

const BASE_STYLE = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0b1729;background:#eef4ff;-webkit-text-size-adjust:100%}
body::before,body::after{content:"";position:fixed;border-radius:50%;filter:blur(60px);opacity:.55;pointer-events:none;z-index:0}
body::before{width:60vw;height:60vw;top:-22vw;right:-18vw;background:radial-gradient(circle,#4f8cff,#a9d8ff)}
body::after{width:56vw;height:56vw;bottom:-24vw;left:-20vw;background:radial-gradient(circle,#4ce0a5,#d5f7e8)}
.ww-page{position:relative;z-index:1;max-width:520px;margin:0 auto;padding:22px 16px 40px;display:grid;gap:14px;background:linear-gradient(165deg,#eaf1ff 0%,#f7fbff 48%,#eafaf3 100%)}
.ww-card{background:rgba(255,255,255,.8);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.9);border-radius:20px;padding:18px;box-shadow:0 18px 40px -24px rgba(12,32,64,.45)}
.ww-eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5b6b84}
.ww-title{margin:0 0 6px;font-size:22px;line-height:1.2;font-weight:700}
.ww-sub{margin:0;font-size:14px;color:#5b6b84}
.ww-field{display:block;margin-top:12px}
.ww-field span{display:block;font-size:12px;font-weight:600;color:#5b6b84;margin-bottom:6px}
.ww-field input,.ww-field select{width:100%;padding:13px 14px;font-size:16px;border-radius:13px;border:1px solid rgba(11,23,41,.14);background:#fff;color:inherit}
.ww-btn{display:block;width:100%;text-align:center;text-decoration:none;font-weight:600;font-size:15px;padding:13px 16px;border-radius:14px;border:1px solid transparent;cursor:pointer;margin-top:12px}
.ww-btn-primary{background:linear-gradient(135deg,#1d6ef5,#0d47b5);color:#fff;box-shadow:0 12px 22px -14px rgba(13,71,181,.9)}
.ww-btn-connect{background:linear-gradient(135deg,#12b26a,#0b8f53);color:#fff}
.ww-btn-ghost{background:rgba(255,255,255,.72);border-color:rgba(11,23,41,.10);color:#0b1729}
.ww-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ww-grid .ww-btn{margin-top:0}
.ww-msg{margin-top:12px;font-size:14px;border-radius:12px;padding:10px 12px;background:rgba(214,45,45,.08);color:#a11616}
.ww-msg[hidden]{display:none}
.ww-foot{text-align:center;font-size:12px;color:#5b6b84}
.ww-foot a{color:#1d6ef5;font-weight:600}
[hidden]{display:none!important}
@media(min-width:560px){.ww-title{font-size:26px}}
`.trim();

/**
 * The Omada runtime, rewritten in vanilla JS from the audited master.
 * Placeholders __WW_CONFIG__ is replaced at generation time.
 */
const BASE_SCRIPT = String.raw`
(function(){
  var CFG = __WW_CONFIG__;

  /* ---- Omada client context: exactly the parameters the master reads ---- */
  var QUERY_KEYS = ["clientMac","apMac","gatewayMac","ssidName","radioId","vid","originUrl","previewSite"];
  var ctx = {};
  (function(){
    var q;
    try { q = new URLSearchParams(window.location.search); } catch (e) { q = null; }
    for (var i=0;i<QUERY_KEYS.length;i++){
      var k = QUERY_KEYS[i];
      var v = q ? q.get(k) : null;
      ctx[k] = v === null ? "" : v;
    }
  })();

  function omadaPayload(extra){
    var body = {
      clientMac: ctx.clientMac,
      apMac: ctx.apMac,
      gatewayMac: ctx.gatewayMac,
      ssidName: ctx.ssidName,
      radioId: ctx.radioId === "" ? ctx.radioId : Number(ctx.radioId),
      vid: ctx.vid === "" ? ctx.vid : Number(ctx.vid),
      originUrl: ctx.originUrl
    };
    if (extra) for (var k in extra){ if (Object.prototype.hasOwnProperty.call(extra,k)) body[k] = extra[k]; }
    return body;
  }

  function post(url, body){
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json;charset=UTF-8" },
      body: JSON.stringify(body)
    }).then(function(r){ return r.json(); });
  }

  /* ---- Controller error codes preserved from the master ---- */
  var ERRORS = {
    "-41500":"The authentication type is not available on this hotspot.",
    "-41501":"This login is not allowed right now.",
    "-41502":"Your session has expired. Please try again.",
    "-41503":"Too many devices are already using this code.",
    "-41504":"This code has already been used up.",
    "-41505":"This code has expired.",
    "-41506":"That code is not valid.",
    "-41507":"That user name or password is not correct.",
    "-41508":"This account has expired.",
    "-41509":"This account is already in use on another device.",
    "-41510":"The data limit for this code has been reached.",
    "-41511":"The time limit for this code has been reached.",
    "-41512":"The hotspot rejected the request. Please try again.",
    "-41513":"The verification code is not correct.",
    "-41514":"The verification code has expired.",
    "-41515":"Please wait before requesting another verification code.",
    "-41516":"That phone number cannot be used here.",
    "-41517":"The SMS service is not available right now.",
    "-41518":"The RADIUS server did not accept the login.",
    "-41519":"The RADIUS server did not answer.",
    "-41520":"The LDAP server did not accept the login.",
    "-41521":"The LDAP server did not answer.",
    "-41522":"The portal settings have changed. Reload this page.",
    "-41523":"Your device could not be identified by the hotspot.",
    "-41524":"This device is not allowed on this network.",
    "-41525":"The hotspot is busy. Please try again in a moment.",
    "-41526":"This form could not be submitted.",
    "-41527":"A required field is missing.",
    "-41528":"That value is not in the expected format.",
    "-41529":"This portal is disabled.",
    "-41530":"The maximum number of users has been reached.",
    "-41531":"The daily limit for this account has been reached.",
    "-41532":"This account is suspended.",
    "-41533":"Authentication is temporarily locked. Please wait and try again.",
    "-41534":"The hotspot could not reach the authentication server.",
    "-41535":"The request could not be verified.",
    "-41536":"The network changed during login. Please try again.",
    "-41537":"The hotspot refused this request.",
    "-41538":"Login failed. Please try again."
  };
  function errorText(code){
    var key = String(code);
    if (ERRORS[key]) return ERRORS[key];
    return "Login failed (code " + key + "). Please try again.";
  }

  var el = function(id){ return document.getElementById(id); };
  var msg = el("ww-msg");
  function showError(text){ if(!msg) return; msg.textContent = text; msg.removeAttribute("hidden"); }
  function clearError(){ if(!msg) return; msg.textContent = ""; msg.setAttribute("hidden",""); }

  /* ---- Landing redirect, exactly as the master does it ---- */
  function landing(data){
    var url = (data && (data.landingUrl || data.result)) || (data && data.data && (data.data.landingUrl || data.data.result));
    if (typeof url === "string" && url) { window.location.href = url; return true; }
    return false;
  }

  function handle(data){
    if (!data) { showError("The hotspot did not answer. Please try again."); return; }
    if (data.errorCode === 0) { if (!landing(data)) window.location.reload(); return; }
    showError(data.msg || errorText(data.errorCode));
  }

  /* ---- Portal page setting: drives which auth types are offered ---- */
  var setting = { authType: CFG.defaultAuthType, enabledTypes: [], buttonText: "", formAuthButtonText: "", formAuth: null, countryCode: "" };

  function applySetting(data){
    var d = (data && data.result) || (data && data.data) || data || {};
    if (typeof d.authType === "number") setting.authType = d.authType;
    if (d.hotspot && Object.prototype.toString.call(d.hotspot.enabledTypes) === "[object Array]") setting.enabledTypes = d.hotspot.enabledTypes;
    if (d.portalCustomize){
      if (d.portalCustomize.buttonText) setting.buttonText = d.portalCustomize.buttonText;
      if (d.portalCustomize.formAuthButtonText) setting.formAuthButtonText = d.portalCustomize.formAuthButtonText;
    }
    if (d.formAuth) setting.formAuth = d.formAuth;
    if (d.sms && d.sms.countryCode) setting.countryCode = d.sms.countryCode;
    render();
  }

  var AUTH = { externalRadius:2, voucher:3, localUser:5, sms:6, radius:8, formAuth:12, externalLdap:15 };

  function offered(type){
    if (setting.enabledTypes && setting.enabledTypes.length) {
      for (var i=0;i<setting.enabledTypes.length;i++) if (Number(setting.enabledTypes[i]) === type) return true;
      return Number(setting.authType) === type;
    }
    return Number(setting.authType) === type;
  }

  function render(){
    /* Manual voucher entry is always rendered; it is never gated. */
    var show = {
      "ww-user": offered(AUTH.localUser) || offered(AUTH.radius) || offered(AUTH.externalRadius) || offered(AUTH.externalLdap),
      "ww-sms": offered(AUTH.sms),
      "ww-form": offered(AUTH.formAuth)
    };
    for (var id in show){
      var node = el(id);
      if (!node) continue;
      if (show[id]) node.removeAttribute("hidden"); else node.setAttribute("hidden","");
    }
    var btn = el("ww-voucher-submit");
    if (btn && setting.buttonText) btn.textContent = setting.buttonText;
    var fbtn = el("ww-form-submit");
    if (fbtn && setting.formAuthButtonText) fbtn.textContent = setting.formAuthButtonText;
    var cc = el("ww-sms-country");
    if (cc && setting.countryCode) cc.value = setting.countryCode;
  }

  post(CFG.endpoints.pageSetting, omadaPayload({}))
    .then(applySetting)
    .catch(function(){ render(); });

  /* ---- Authentication ---- */
  function authenticate(endpoint, extra){
    clearError();
    post(endpoint, omadaPayload(extra)).then(handle).catch(function(){
      showError("The hotspot could not be reached. Please try again.");
    });
  }

  var voucherForm = el("ww-voucher-form");
  if (voucherForm) voucherForm.addEventListener("submit", function(e){
    e.preventDefault();
    var code = (el("ww-voucher-code") || {}).value || "";
    if (!code) { showError("Enter your voucher code."); return; }
    authenticate(CFG.endpoints.auth, { authType: AUTH.voucher, voucherCode: code });
  });

  var userForm = el("ww-user-form");
  if (userForm) userForm.addEventListener("submit", function(e){
    e.preventDefault();
    var u = (el("ww-user-name") || {}).value || "";
    var p = (el("ww-user-password") || {}).value || "";
    var type = offered(AUTH.externalLdap) ? AUTH.externalLdap
      : offered(AUTH.radius) ? AUTH.radius
      : offered(AUTH.externalRadius) ? AUTH.externalRadius
      : AUTH.localUser;
    var endpoint = type === AUTH.externalLdap ? CFG.endpoints.ldapAuth
      : (type === AUTH.radius || type === AUTH.externalRadius) ? CFG.endpoints.radiusAuth
      : CFG.endpoints.auth;
    authenticate(endpoint, { authType: type, username: u, password: p });
  });

  var smsSend = el("ww-sms-send");
  if (smsSend) smsSend.addEventListener("click", function(e){
    e.preventDefault();
    clearError();
    var phone = (el("ww-sms-phone") || {}).value || "";
    var cc = (el("ww-sms-country") || {}).value || setting.countryCode || "";
    if (!phone) { showError("Enter your mobile number."); return; }
    post(CFG.endpoints.sendSmsAuthCode, omadaPayload({ phone: cc ? cc + phone : phone }))
      .then(function(d){
        if (d && d.errorCode === 0) { showError("We sent you a verification code."); return; }
        showError((d && d.msg) || errorText(d && d.errorCode));
      })
      .catch(function(){ showError("The verification code could not be sent."); });
  });

  var smsForm = el("ww-sms-form");
  if (smsForm) smsForm.addEventListener("submit", function(e){
    e.preventDefault();
    var phone = (el("ww-sms-phone") || {}).value || "";
    var cc = (el("ww-sms-country") || {}).value || setting.countryCode || "";
    var code = (el("ww-sms-code") || {}).value || "";
    authenticate(CFG.endpoints.auth, { authType: AUTH.sms, phone: cc ? cc + phone : phone, code: code });
  });

  var formAuth = el("ww-form-form");
  if (formAuth) formAuth.addEventListener("submit", function(e){
    e.preventDefault();
    var name = (el("ww-form-name") || {}).value || "";
    var contact = (el("ww-form-contact") || {}).value || "";
    authenticate(CFG.endpoints.auth, { authType: AUTH.formAuth, name: name, email: contact });
  });

  /* ---- WaveWallet features (only the ones the admin enabled) ---- */
  var SESSION = null;
  function link(intent){
    var url = CFG.origin + "/portal";
    var parts = ["wwPortal=" + encodeURIComponent(CFG.mappingId)];
    if (SESSION) parts.push("wwSession=" + encodeURIComponent(SESSION));
    if (intent) parts.push("wwIntent=" + encodeURIComponent(intent));
    for (var i=0;i<QUERY_KEYS.length;i++){
      var k = QUERY_KEYS[i];
      if (ctx[k]) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(ctx[k]));
    }
    return url + "?" + parts.join("&");
  }
  function applyLinks(){
    var anchors = document.querySelectorAll("[data-ww-link]");
    for (var i=0;i<anchors.length;i++){
      var a = anchors[i];
      var kind = a.getAttribute("data-ww-link");
      if (kind === "signup"){
        if (!CFG.signupUrl) { a.setAttribute("hidden",""); continue; }
        a.setAttribute("href", CFG.signupUrl);
      } else {
        a.setAttribute("href", link(kind));
      }
      a.setAttribute("target","_blank");
      a.setAttribute("rel","noopener");
    }
  }
  applyLinks();

  /* Hand-off to WaveWallet: the server validates the portal binding and
     answers with a short-lived hotspot session id. No balance, no name and no
     code is ever returned to this page. */
  try {
    fetch(CFG.origin + "/api/public/portal-context", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappingId: CFG.mappingId, context: ctx })
    })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if (!d || !d.ok) return;
        SESSION = d.sessionId || null;
        applyLinks();
      })
      .catch(function(){});
  } catch (e) {}
})();
`.trim();

export interface BaseTemplateInfo {
  version: number;
  checksum: string;
  bytes: number;
  audit: RuntimeAuditEntry[];
  queryParams: readonly string[];
  endpoints: typeof OMADA_ENDPOINTS;
}

/** The derived base template, before any shop configuration is applied. */
export function baseTemplateSource(): string {
  return [BASE_STYLE, BASE_SCRIPT].join("\n/*--*/\n");
}

export function baseTemplateInfo(): BaseTemplateInfo {
  const source = baseTemplateSource();
  return {
    version: BASE_TEMPLATE_VERSION,
    checksum: checksumOf(source),
    bytes: byteSize(source),
    audit: OMADA_RUNTIME_AUDIT,
    queryParams: OMADA_QUERY_PARAMS,
    endpoints: OMADA_ENDPOINTS,
  };
}

export { BASE_STYLE, BASE_SCRIPT };
