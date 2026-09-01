/**
 * Portal Design Gallery.
 *
 * A theme is PRESENTATION ONLY. It never touches the canonical Omada master's
 * runtime: the same markup slots, the same moved-in voucher form, the same
 * Omada scripts and hidden fields. A theme only decides colours, typography,
 * layout composition and a CSS-only decorative treatment.
 *
 * The catalog itself is database-backed (public.omada_portal_themes). The
 * definitions below are the seed/fallback used when the database cannot be
 * read (offline preview, tests) so generation is never blocked.
 *
 * Hard rules for every theme:
 *  - no external fonts, images, CDNs, analytics or any network dependency;
 *  - decorative backgrounds are gradients/shapes/patterns only;
 *  - tiny: the whole theme layer is a few kB of CSS.
 */

export type PortalThemeLayout = "stack" | "hero" | "split" | "ticket" | "panel" | "card-deck";
export type PortalThemeDecor =
  | "aurora"
  | "aurora-dark"
  | "steam"
  | "grid-neon"
  | "waves"
  | "paper-lines"
  | "peaks"
  | "mesh"
  | "sunburst"
  | "neon-city"
  | "dots"
  | "scanlines";
export type PortalThemeFont = "system" | "serif" | "mono" | "rounded" | "display";
export type PortalThemeMotion = "none" | "subtle" | "bold";

export interface PortalThemeTokens {
  ink: string;
  muted: string;
  brand: string;
  accent: string;
  surface: string;
  line: string;
  bg1: string;
  bg2: string;
  bg3: string;
  radius: string;
  btnRadius: string;
}

export interface PortalTheme {
  slug: string;
  name: string;
  description: string;
  category: string;
  layout: PortalThemeLayout;
  decor: PortalThemeDecor;
  fontStack: PortalThemeFont;
  motion: PortalThemeMotion;
  sortOrder: number;
  tokens: PortalThemeTokens;
}

/* ------------------------------------------------------------------ *
 * Seed / fallback catalog — mirrors public.omada_portal_themes        *
 * ------------------------------------------------------------------ */

const t = (v: PortalThemeTokens) => v;

export const PORTAL_THEMES: PortalTheme[] = [
  {
    slug: "modern-minimal",
    name: "Modern Minimal",
    description: "Clean white cards, airy spacing and a soft aurora wash. Fastest and most neutral.",
    category: "minimal",
    layout: "stack",
    decor: "aurora",
    fontStack: "system",
    motion: "subtle",
    sortOrder: 10,
    tokens: t({
      ink: "#0b1729",
      muted: "#5b6b84",
      brand: "#1d6ef5",
      accent: "#12b26a",
      surface: "rgba(255,255,255,.80)",
      line: "rgba(11,23,41,.10)",
      bg1: "#eaf1ff",
      bg2: "#f7fbff",
      bg3: "#eafaf3",
      radius: "20px",
      btnRadius: "14px",
    }),
  },
  {
    slug: "coffee-house",
    name: "Coffee Shop / Café",
    description: "Warm roasted browns, a torn-ticket receipt card and gentle rising steam.",
    category: "hospitality",
    layout: "ticket",
    decor: "steam",
    fontStack: "serif",
    motion: "subtle",
    sortOrder: 20,
    tokens: t({
      ink: "#2b1a10",
      muted: "#7a6252",
      brand: "#8a5a2b",
      accent: "#3f7d52",
      surface: "rgba(255,250,244,.92)",
      line: "rgba(43,26,16,.14)",
      bg1: "#f3e6d6",
      bg2: "#faf3e9",
      bg3: "#e8d6c0",
      radius: "10px",
      btnRadius: "10px",
    }),
  },
  {
    slug: "cyber-arena",
    name: "Computer Shop / Gaming",
    description: "Dark angular panels, a neon grid floor and sharp monospace headings.",
    category: "gaming",
    layout: "panel",
    decor: "grid-neon",
    fontStack: "mono",
    motion: "bold",
    sortOrder: 30,
    tokens: t({
      ink: "#e8f4ff",
      muted: "#8fa6c4",
      brand: "#25d0ff",
      accent: "#b14cff",
      surface: "rgba(13,20,36,.82)",
      line: "rgba(37,208,255,.28)",
      bg1: "#060b16",
      bg2: "#0b1226",
      bg3: "#120a24",
      radius: "6px",
      btnRadius: "6px",
    }),
  },
  {
    slug: "sea-front",
    name: "Sea Front / Tropical",
    description: "Turquoise water, layered CSS wave crests and a bright floating hero.",
    category: "tropical",
    layout: "hero",
    decor: "waves",
    fontStack: "rounded",
    motion: "subtle",
    sortOrder: 40,
    tokens: t({
      ink: "#04303a",
      muted: "#3d6b74",
      brand: "#0aa3b8",
      accent: "#f2a541",
      surface: "rgba(255,255,255,.86)",
      line: "rgba(4,48,58,.12)",
      bg1: "#d8f4f7",
      bg2: "#f2fdfd",
      bg3: "#bde8ef",
      radius: "24px",
      btnRadius: "999px",
    }),
  },
  {
    slug: "campus",
    name: "School / Campus",
    description: "Ruled-paper backdrop, notebook margin line and a tidy two-column split.",
    category: "education",
    layout: "split",
    decor: "paper-lines",
    fontStack: "serif",
    motion: "subtle",
    sortOrder: 50,
    tokens: t({
      ink: "#161d2f",
      muted: "#5c667f",
      brand: "#1f4bb8",
      accent: "#c8102e",
      surface: "rgba(255,255,255,.94)",
      line: "rgba(22,29,47,.12)",
      bg1: "#eef2fb",
      bg2: "#ffffff",
      bg3: "#e6ecf9",
      radius: "12px",
      btnRadius: "10px",
    }),
  },
  {
    slug: "highland",
    name: "Mountain / Nature",
    description: "Layered CSS ridge lines, pine greens and a wide calm hero band.",
    category: "nature",
    layout: "hero",
    decor: "peaks",
    fontStack: "system",
    motion: "subtle",
    sortOrder: 60,
    tokens: t({
      ink: "#10241c",
      muted: "#4d6b5f",
      brand: "#1f7a52",
      accent: "#c2703a",
      surface: "rgba(255,255,255,.88)",
      line: "rgba(16,36,28,.12)",
      bg1: "#e3f0e6",
      bg2: "#f6fbf6",
      bg3: "#cfe2d6",
      radius: "18px",
      btnRadius: "12px",
    }),
  },
  {
    slug: "executive",
    name: "Business / Professional",
    description: "Restrained navy panels, a fine mesh pattern and confident uppercase labels.",
    category: "business",
    layout: "panel",
    decor: "mesh",
    fontStack: "system",
    motion: "none",
    sortOrder: 70,
    tokens: t({
      ink: "#0d1b2a",
      muted: "#5a6a80",
      brand: "#12395f",
      accent: "#b58a2b",
      surface: "rgba(255,255,255,.95)",
      line: "rgba(13,27,42,.14)",
      bg1: "#eef1f5",
      bg2: "#f9fafc",
      bg3: "#e2e7ee",
      radius: "8px",
      btnRadius: "8px",
    }),
  },
  {
    slug: "island-resort",
    name: "Travel / Resort",
    description: "Sunset gradient, radiating sunburst rays and generous rounded cards.",
    category: "travel",
    layout: "hero",
    decor: "sunburst",
    fontStack: "rounded",
    motion: "subtle",
    sortOrder: 80,
    tokens: t({
      ink: "#3a1d24",
      muted: "#7d5a5f",
      brand: "#e2603f",
      accent: "#0f9b8e",
      surface: "rgba(255,252,249,.90)",
      line: "rgba(58,29,36,.12)",
      bg1: "#ffe6d2",
      bg2: "#fff6ee",
      bg3: "#ffd2c2",
      radius: "26px",
      btnRadius: "999px",
    }),
  },
  {
    slug: "night-neon",
    name: "Night Neon / Entertainment",
    description: "Deep night skyline, glowing magenta edges and a stacked card deck.",
    category: "entertainment",
    layout: "card-deck",
    decor: "neon-city",
    fontStack: "display",
    motion: "bold",
    sortOrder: 90,
    tokens: t({
      ink: "#f6e9ff",
      muted: "#b79ad6",
      brand: "#ff3d9a",
      accent: "#38e8ff",
      surface: "rgba(22,10,38,.80)",
      line: "rgba(255,61,154,.30)",
      bg1: "#0a0517",
      bg2: "#170a2b",
      bg3: "#25073a",
      radius: "18px",
      btnRadius: "999px",
    }),
  },
  {
    slug: "community-store",
    name: "Community / Local Store",
    description: "Friendly sari-sari colours, polka-dot texture and a clear price-tag card.",
    category: "community",
    layout: "ticket",
    decor: "dots",
    fontStack: "rounded",
    motion: "subtle",
    sortOrder: 100,
    tokens: t({
      ink: "#25200f",
      muted: "#6d6547",
      brand: "#e0362b",
      accent: "#1f7a3d",
      surface: "rgba(255,253,245,.94)",
      line: "rgba(37,32,15,.14)",
      bg1: "#fff3d6",
      bg2: "#fffaf0",
      bg3: "#ffe4b8",
      radius: "14px",
      btnRadius: "12px",
    }),
  },
  {
    slug: "midnight-glass",
    name: "Midnight Glass",
    description: "Dark frosted glass, a slow aurora bloom and quiet high-contrast type.",
    category: "minimal",
    layout: "stack",
    decor: "aurora-dark",
    fontStack: "system",
    motion: "subtle",
    sortOrder: 110,
    tokens: t({
      ink: "#e8eefc",
      muted: "#93a3c2",
      brand: "#6f8cff",
      accent: "#39d3a7",
      surface: "rgba(18,24,42,.72)",
      line: "rgba(232,238,252,.14)",
      bg1: "#070b16",
      bg2: "#0e1526",
      bg3: "#101f2c",
      radius: "22px",
      btnRadius: "14px",
    }),
  },
  {
    slug: "retro-arcade",
    name: "Retro Arcade",
    description: "Scanline CRT backdrop, chunky pixel-style type and blocky stacked panels.",
    category: "gaming",
    layout: "card-deck",
    decor: "scanlines",
    fontStack: "mono",
    motion: "bold",
    sortOrder: 120,
    tokens: t({
      ink: "#fdf6e3",
      muted: "#b3a68a",
      brand: "#ffb400",
      accent: "#ff4d6d",
      surface: "rgba(28,20,44,.86)",
      line: "rgba(255,180,0,.32)",
      bg1: "#140d24",
      bg2: "#1d1233",
      bg3: "#2a1140",
      radius: "4px",
      btnRadius: "4px",
    }),
  },
];

export const DEFAULT_PORTAL_THEME_SLUG = "modern-minimal";

export function defaultPortalTheme(): PortalTheme {
  return PORTAL_THEMES[0] as PortalTheme;
}

const LAYOUTS = new Set<PortalThemeLayout>([
  "stack",
  "hero",
  "split",
  "ticket",
  "panel",
  "card-deck",
]);
const DECORS = new Set<PortalThemeDecor>([
  "aurora",
  "aurora-dark",
  "steam",
  "grid-neon",
  "waves",
  "paper-lines",
  "peaks",
  "mesh",
  "sunburst",
  "neon-city",
  "dots",
  "scanlines",
]);
const FONTS = new Set<PortalThemeFont>(["system", "serif", "mono", "rounded", "display"]);
const MOTIONS = new Set<PortalThemeMotion>(["none", "subtle", "bold"]);

/** Only CSS-safe colour/length literals ever reach the generated page. */
const SAFE_VALUE = /^[#a-zA-Z0-9 ().,%\-/]*$/;

function safe(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 64 || !SAFE_VALUE.test(raw)) return fallback;
  return raw;
}

/** Turns one database row (or anything untrusted) into a usable theme. */
export function normalizePortalTheme(row: unknown, fallback = defaultPortalTheme()): PortalTheme {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const rawTokens = (r["tokens"] && typeof r["tokens"] === "object" ? r["tokens"] : {}) as Record<
    string,
    unknown
  >;
  const slug = typeof r["slug"] === "string" && r["slug"].trim() ? r["slug"].trim() : fallback.slug;
  const layout = r["layout"] as PortalThemeLayout;
  const decor = r["decor"] as PortalThemeDecor;
  const font = (r["font_stack"] ?? r["fontStack"]) as PortalThemeFont;
  const motion = r["motion"] as PortalThemeMotion;
  const order = Number(r["sort_order"] ?? r["sortOrder"]);
  return {
    slug,
    name: typeof r["name"] === "string" && r["name"] ? r["name"] : fallback.name,
    description:
      typeof r["description"] === "string" && r["description"] ? r["description"] : fallback.description,
    category: typeof r["category"] === "string" && r["category"] ? r["category"] : fallback.category,
    layout: LAYOUTS.has(layout) ? layout : fallback.layout,
    decor: DECORS.has(decor) ? decor : fallback.decor,
    fontStack: FONTS.has(font) ? font : fallback.fontStack,
    motion: MOTIONS.has(motion) ? motion : fallback.motion,
    sortOrder: Number.isFinite(order) ? order : fallback.sortOrder,
    tokens: {
      ink: safe(rawTokens["ink"], fallback.tokens.ink),
      muted: safe(rawTokens["muted"], fallback.tokens.muted),
      brand: safe(rawTokens["brand"], fallback.tokens.brand),
      accent: safe(rawTokens["accent"], fallback.tokens.accent),
      surface: safe(rawTokens["surface"], fallback.tokens.surface),
      line: safe(rawTokens["line"], fallback.tokens.line),
      bg1: safe(rawTokens["bg1"], fallback.tokens.bg1),
      bg2: safe(rawTokens["bg2"], fallback.tokens.bg2),
      bg3: safe(rawTokens["bg3"], fallback.tokens.bg3),
      radius: safe(rawTokens["radius"], fallback.tokens.radius),
      btnRadius: safe(rawTokens["btnRadius"], fallback.tokens.btnRadius),
    },
  };
}

/** Picks a theme out of a catalog; falls back to the built-in default. */
export function resolvePortalTheme(
  slug: string | null | undefined,
  catalog: PortalTheme[] = PORTAL_THEMES,
): PortalTheme {
  const list = catalog.length ? catalog : PORTAL_THEMES;
  return (
    list.find((th) => th.slug === slug) ??
    list.find((th) => th.slug === DEFAULT_PORTAL_THEME_SLUG) ??
    (list[0] as PortalTheme)
  );
}

/* ------------------------------------------------------------------ *
 * CSS composition                                                     *
 * ------------------------------------------------------------------ */

const FONT_STACKS: Record<PortalThemeFont, string> = {
  system: `ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`,
  serif: `ui-serif,Georgia,"Times New Roman",serif`,
  mono: `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`,
  rounded: `ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif`,
  display: `"Trebuchet MS","Segoe UI",system-ui,sans-serif`,
};

/** Shared skeleton. Identical for every theme, so behaviour never varies. */
const BASE_CSS = `
#ww-portal *{box-sizing:border-box}
#ww-portal{position:relative;margin:0;padding:22px 16px 44px;color:var(--ww-ink);font-family:var(--ww-font);background:linear-gradient(160deg,var(--ww-bg1) 0%,var(--ww-bg2) 48%,var(--ww-bg3) 100%);overflow:hidden}
#ww-portal .ww-decor{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#ww-portal .ww-decor i{position:absolute;display:block}
.ww-wrap{position:relative;max-width:520px;margin:0 auto;display:grid;gap:14px}
.ww-card{position:relative;background:var(--ww-surface);border:1px solid var(--ww-line);border-radius:var(--ww-radius);padding:18px;box-shadow:0 18px 40px -26px rgba(4,10,22,.55)}
.ww-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ww-muted);margin:0 0 6px}
.ww-title{font-size:22px;line-height:1.22;font-weight:700;margin:0 0 6px}
.ww-sub{font-size:14px;line-height:1.45;color:var(--ww-muted);margin:0}
.ww-actions{display:grid;gap:10px;margin-top:14px}
.ww-btn{display:block;width:100%;text-align:center;text-decoration:none;font-weight:600;font-size:15px;padding:13px 16px;border-radius:var(--ww-btn-radius);border:1px solid transparent;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,filter .15s ease}
.ww-btn-primary{background:linear-gradient(135deg,var(--ww-brand),var(--ww-accent));color:#fff}
.ww-btn-ghost{background:transparent;border-color:var(--ww-line);color:var(--ww-ink)}
.ww-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ww-slot{margin-top:6px}
.ww-slot form{margin:0}
.ww-slot input[type=text],.ww-slot input[type=password],.ww-slot input:not([type]){width:100%;padding:12px 14px;border-radius:var(--ww-btn-radius);border:1px solid var(--ww-line);font-size:16px;background:rgba(255,255,255,.92);color:#0b1729}
.ww-slot button,.ww-slot input[type=submit],.ww-slot input[type=button]{width:100%;margin-top:10px;padding:13px 16px;border-radius:var(--ww-btn-radius);border:0;background:linear-gradient(135deg,var(--ww-accent),var(--ww-brand));color:#fff;font-size:15px;font-weight:600}
.ww-foot{text-align:center;font-size:12px;color:var(--ww-muted)}
.ww-foot a{color:var(--ww-brand);font-weight:600}
html,body{margin:0;padding:0;overflow-x:hidden}
.hidden{display:none}
#ww-portal .ww-off{display:none!important}
#ww-portal .ww-on{display:block!important}
#ww-portal .ww-panel-label{display:block;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--ww-muted);margin:0 0 4px}
.ww-omada-off{position:fixed!important;left:-10000px!important;top:0!important;width:1px!important;height:1px!important;max-width:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;z-index:-1!important}
.ww-seg{display:flex;gap:6px;padding:4px;margin:0 0 12px;border:1px solid var(--ww-line);border-radius:var(--ww-btn-radius);background:rgba(255,255,255,.06)}
.ww-seg button{flex:1;min-height:44px;padding:0 12px;border:0;border-radius:var(--ww-btn-radius);background:transparent;color:var(--ww-ink);font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.ww-seg button[aria-selected=true]{background:linear-gradient(135deg,var(--ww-brand),var(--ww-accent));color:#fff}
.ww-error{margin:10px 0 0;font-size:13px;font-weight:600;color:#ff5a5f;word-break:break-word}
.ww-slot .input-container{margin-bottom:10px}
.ww-slot .icon{display:none}
#ww-auth-action{margin-top:2px}
#ww-auth-action button,#ww-auth-action a,#ww-auth-action input[type=submit],#ww-auth-action input[type=button]{display:block;width:100%;min-height:48px;margin-top:10px;padding:14px 16px;border:0;border-radius:var(--ww-btn-radius);background:linear-gradient(135deg,var(--ww-brand),var(--ww-accent));color:#fff;font-family:inherit;font-size:16px;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
@media (min-width:560px){.ww-title{font-size:26px}}
`.trim();

const LAYOUT_CSS: Record<PortalThemeLayout, string> = {
  stack: `
.ww-wrap{gap:14px}
.ww-card{backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.ww-title{letter-spacing:-.02em}
`,
  hero: `
#ww-portal{padding-top:0}
.ww-wrap{gap:0;padding-top:96px}
.ww-wrap>.ww-card:first-child{margin-top:-56px;text-align:center;padding:24px 20px}
.ww-wrap>.ww-card:first-child .ww-title{font-size:27px}
.ww-wrap>.ww-card{margin-bottom:14px}
.ww-actions{margin-top:18px}
.ww-btn{box-shadow:0 12px 24px -16px var(--ww-brand)}
`,
  split: `
.ww-wrap{max-width:640px}
.ww-card{padding-left:26px}
.ww-card:before{content:"";position:absolute;left:12px;top:14px;bottom:14px;width:2px;background:var(--ww-accent);opacity:.55;border-radius:2px}
@media (min-width:620px){
 .ww-wrap{grid-template-columns:1.15fr .85fr;align-items:start;gap:14px}
 .ww-wrap>.ww-card:first-child{grid-row:span 2}
}
.ww-title{font-weight:700}
`,
  ticket: `
.ww-card{border-style:dashed}
.ww-card:before,.ww-card:after{content:"";position:absolute;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:var(--ww-bg2);border:1px dashed var(--ww-line)}
.ww-card:before{left:-10px}
.ww-card:after{right:-10px}
.ww-eyebrow{font-weight:700}
.ww-title{letter-spacing:.01em}
.ww-btn-primary{border-radius:var(--ww-btn-radius);box-shadow:0 6px 0 -2px var(--ww-line)}
`,
  panel: `
.ww-card{border-radius:var(--ww-radius);clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);box-shadow:none;border-width:1px}
.ww-eyebrow{letter-spacing:.22em;font-weight:700;color:var(--ww-brand)}
.ww-title{text-transform:none;font-weight:700}
.ww-btn{letter-spacing:.06em;text-transform:uppercase;font-size:13px}
.ww-slot input[type=text],.ww-slot input:not([type]){background:rgba(255,255,255,.96)}
`,
  "card-deck": `
.ww-wrap{gap:18px}
.ww-card{transform:rotate(-.5deg);box-shadow:0 0 0 1px var(--ww-line),0 22px 40px -28px rgba(0,0,0,.85)}
.ww-card:nth-child(even){transform:rotate(.6deg)}
.ww-card:before{content:"";position:absolute;inset:-1px;border-radius:inherit;border:1px solid var(--ww-brand);opacity:.35;pointer-events:none}
.ww-title{text-transform:uppercase;letter-spacing:.04em;font-size:20px}
.ww-btn-primary{box-shadow:0 0 18px -4px var(--ww-brand)}
`,
};

const DECOR_CSS: Record<PortalThemeDecor, string> = {
  aurora: `
.ww-decor i{border-radius:50%;filter:blur(46px);opacity:.5}
.ww-decor i:nth-child(1){width:280px;height:280px;top:-120px;right:-90px;background:radial-gradient(circle,var(--ww-brand),transparent 70%)}
.ww-decor i:nth-child(2){width:260px;height:260px;bottom:-130px;left:-100px;background:radial-gradient(circle,var(--ww-accent),transparent 70%)}
.ww-decor i:nth-child(3){width:180px;height:180px;top:38%;left:-70px;background:radial-gradient(circle,var(--ww-brand),transparent 70%);opacity:.25}
`,
  "aurora-dark": `
.ww-decor i{border-radius:50%;filter:blur(60px);opacity:.42}
.ww-decor i:nth-child(1){width:320px;height:320px;top:-140px;left:-80px;background:radial-gradient(circle,var(--ww-brand),transparent 70%)}
.ww-decor i:nth-child(2){width:300px;height:300px;bottom:-160px;right:-90px;background:radial-gradient(circle,var(--ww-accent),transparent 70%)}
.ww-decor i:nth-child(3){position:absolute;inset:0;background:radial-gradient(120% 60% at 50% 0%,rgba(255,255,255,.06),transparent 60%);filter:none;opacity:1;border-radius:0}
`,
  steam: `
.ww-decor i:nth-child(1),.ww-decor i:nth-child(2),.ww-decor i:nth-child(3){width:16px;height:150px;top:-40px;border-radius:50%;background:linear-gradient(to top,transparent,rgba(255,255,255,.75));filter:blur(9px);opacity:.6}
.ww-decor i:nth-child(1){left:18%}
.ww-decor i:nth-child(2){left:48%;height:190px;animation:ww-rise 7s ease-in-out infinite}
.ww-decor i:nth-child(3){left:78%;animation:ww-rise 9s ease-in-out infinite}
#ww-portal:after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,rgba(43,26,16,.05) 0 2px,transparent 2px 9px);opacity:.5}
@keyframes ww-rise{0%,100%{transform:translateY(6px) scaleY(1)}50%{transform:translateY(-14px) scaleY(1.1)}}
`,
  "grid-neon": `
#ww-portal:before{content:"";position:absolute;left:0;right:0;bottom:0;height:52%;background:linear-gradient(transparent,rgba(37,208,255,.10)),repeating-linear-gradient(90deg,rgba(37,208,255,.22) 0 1px,transparent 1px 42px),repeating-linear-gradient(0deg,rgba(37,208,255,.18) 0 1px,transparent 1px 34px);transform:perspective(320px) rotateX(62deg);transform-origin:bottom;pointer-events:none}
.ww-decor i:nth-child(1){width:70%;height:2px;top:64px;left:15%;background:linear-gradient(90deg,transparent,var(--ww-brand),transparent);box-shadow:0 0 18px var(--ww-brand)}
.ww-decor i:nth-child(2){width:200px;height:200px;top:-90px;right:-60px;border-radius:50%;background:radial-gradient(circle,var(--ww-accent),transparent 68%);filter:blur(40px);opacity:.55}
.ww-decor i:nth-child(3){width:120px;height:120px;bottom:20%;left:-40px;border-radius:50%;background:radial-gradient(circle,var(--ww-brand),transparent 68%);filter:blur(36px);opacity:.4}
`,
  waves: `
.ww-decor i{left:-10%;width:120%;height:120px;border-radius:44%}
.ww-decor i:nth-child(1){top:120px;background:rgba(10,163,184,.22);animation:ww-sway 9s ease-in-out infinite}
.ww-decor i:nth-child(2){top:158px;background:rgba(10,163,184,.16);animation:ww-sway 12s ease-in-out infinite reverse}
.ww-decor i:nth-child(3){top:196px;background:rgba(242,165,65,.14)}
#ww-portal:before{content:"";position:absolute;top:0;left:0;right:0;height:200px;background:linear-gradient(180deg,var(--ww-brand),transparent);opacity:.35;pointer-events:none}
@keyframes ww-sway{0%,100%{transform:translateX(-14px)}50%{transform:translateX(14px)}}
`,
  "paper-lines": `
#ww-portal:before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,transparent 0 27px,rgba(31,75,184,.14) 27px 28px)}
.ww-decor i:nth-child(1){top:0;bottom:0;left:26px;width:2px;background:rgba(200,16,46,.35)}
.ww-decor i:nth-child(2){width:180px;height:180px;top:-70px;right:-50px;border-radius:50%;background:radial-gradient(circle,rgba(31,75,184,.25),transparent 70%);filter:blur(20px)}
.ww-decor i:nth-child(3){display:none}
`,
  peaks: `
.ww-decor i{bottom:0;height:200px;background:var(--ww-brand)}
.ww-decor i:nth-child(1){left:-8%;width:70%;clip-path:polygon(50% 0,100% 100%,0 100%);opacity:.22}
.ww-decor i:nth-child(2){right:-6%;width:62%;clip-path:polygon(50% 0,100% 100%,0 100%);opacity:.30}
.ww-decor i:nth-child(3){left:22%;width:56%;height:150px;clip-path:polygon(50% 0,100% 100%,0 100%);opacity:.16;background:var(--ww-accent)}
#ww-portal:before{content:"";position:absolute;top:26px;right:34px;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(255,255,255,0) 70%);pointer-events:none}
`,
  mesh: `
#ww-portal:before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(45deg,rgba(13,27,42,.05) 0 1px,transparent 1px 12px),repeating-linear-gradient(-45deg,rgba(13,27,42,.05) 0 1px,transparent 1px 12px)}
.ww-decor i:nth-child(1){top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,var(--ww-brand),var(--ww-accent))}
.ww-decor i:nth-child(2){width:240px;height:240px;bottom:-120px;right:-90px;background:linear-gradient(135deg,rgba(18,57,95,.16),transparent);transform:rotate(18deg)}
.ww-decor i:nth-child(3){display:none}
`,
  sunburst: `
#ww-portal:before{content:"";position:absolute;top:-160px;left:50%;width:520px;height:520px;margin-left:-260px;background:repeating-conic-gradient(from 0deg,rgba(226,96,63,.16) 0deg 9deg,transparent 9deg 18deg);border-radius:50%;pointer-events:none}
.ww-decor i:nth-child(1){top:-90px;left:50%;width:220px;height:220px;margin-left:-110px;border-radius:50%;background:radial-gradient(circle,rgba(255,214,170,.95),rgba(255,214,170,0) 70%)}
.ww-decor i:nth-child(2){bottom:-120px;left:-15%;width:130%;height:230px;border-radius:50%;background:rgba(15,155,142,.16)}
.ww-decor i:nth-child(3){bottom:-160px;left:-15%;width:130%;height:230px;border-radius:50%;background:rgba(15,155,142,.12)}
`,
  "neon-city": `
.ww-decor i:nth-child(1){bottom:0;left:0;right:0;height:150px;background:repeating-linear-gradient(90deg,rgba(255,61,154,.20) 0 26px,transparent 26px 34px,rgba(56,232,255,.18) 34px 54px,transparent 54px 66px);-webkit-mask-image:linear-gradient(transparent,#000);mask-image:linear-gradient(transparent,#000)}
.ww-decor i:nth-child(2){top:-100px;right:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,var(--ww-brand),transparent 68%);filter:blur(48px);opacity:.55}
.ww-decor i:nth-child(3){top:30%;left:-70px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,var(--ww-accent),transparent 68%);filter:blur(48px);opacity:.4}
`,
  dots: `
#ww-portal:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(rgba(224,54,43,.16) 1.6px,transparent 1.7px);background-size:16px 16px}
.ww-decor i:nth-child(1){top:0;left:0;right:0;height:14px;background:repeating-linear-gradient(90deg,var(--ww-brand) 0 24px,var(--ww-accent) 24px 48px);opacity:.85}
.ww-decor i:nth-child(2){bottom:0;left:0;right:0;height:14px;background:repeating-linear-gradient(90deg,var(--ww-accent) 0 24px,var(--ww-brand) 24px 48px);opacity:.6}
.ww-decor i:nth-child(3){display:none}
`,
  scanlines: `
#ww-portal:before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 3px)}
.ww-decor i:nth-child(1){inset:0;background:radial-gradient(120% 80% at 50% 0%,rgba(255,180,0,.16),transparent 62%)}
.ww-decor i:nth-child(2){bottom:0;left:0;right:0;height:120px;background:repeating-linear-gradient(90deg,rgba(255,77,109,.22) 0 12px,transparent 12px 24px)}
.ww-decor i:nth-child(3){top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--ww-brand),var(--ww-accent),var(--ww-brand))}
`,
};

const MOTION_CSS: Record<PortalThemeMotion, string> = {
  none: `
.ww-decor i{animation:none!important}
.ww-btn{transition:none}
`,
  subtle: `
.ww-btn:active{transform:translateY(1px)}
.ww-btn-primary:hover{filter:brightness(1.05)}
.ww-card{animation:ww-in .35s ease both}
@keyframes ww-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`,
  bold: `
.ww-btn:active{transform:translateY(2px) scale(.99)}
.ww-btn-primary:hover{filter:brightness(1.12);box-shadow:0 0 22px -4px var(--ww-brand)}
.ww-card{animation:ww-in .4s cubic-bezier(.2,.8,.2,1) both}
.ww-card:nth-child(2){animation-delay:.06s}
.ww-card:nth-child(3){animation-delay:.12s}
@keyframes ww-in{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
`,
};

/** Everything animated is disabled for people who ask for less motion. */
const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion:reduce){#ww-portal *,#ww-portal *:before,#ww-portal *:after{animation:none!important;transition:none!important}}
`.trim();

function tokensCss(theme: PortalTheme): string {
  const k = theme.tokens;
  return `#ww-portal{--ww-ink:${k.ink};--ww-muted:${k.muted};--ww-brand:${k.brand};--ww-accent:${k.accent};--ww-surface:${k.surface};--ww-line:${k.line};--ww-bg1:${k.bg1};--ww-bg2:${k.bg2};--ww-bg3:${k.bg3};--ww-radius:${k.radius};--ww-btn-radius:${k.btnRadius};--ww-font:${FONT_STACKS[theme.fontStack]}}`;
}

function squeeze(css: string): string {
  return css
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * The complete presentation layer for one theme. Pure: the same theme always
 * yields the same bytes, so preview and download can never drift.
 */
export function buildPortalThemeCss(theme: PortalTheme): string {
  return squeeze(
    [
      tokensCss(theme),
      BASE_CSS,
      LAYOUT_CSS[theme.layout],
      DECOR_CSS[theme.decor],
      MOTION_CSS[theme.motion],
      REDUCED_MOTION_CSS,
    ].join("\n"),
  );
}

/** The decorative shapes the theme CSS positions. Purely presentational. */
export const THEME_DECOR_MARKUP = `<div class="ww-decor" aria-hidden="true"><i></i><i></i><i></i></div>`;

/**
 * A tiny self-contained page used for the gallery thumbnail and the full
 * preview. It shares the exact theme CSS with the generated portal, so what an
 * admin sees is what the portal looks like. No network access of any kind.
 */
export function portalThemePreviewHtml(
  theme: PortalTheme,
  opts: {
    shopName?: string;
    compact?: boolean;
    features?: Partial<PortalSectionFeatures>;
  } = {},
): string {
  const shop = opts.shopName ?? "Your shop";
  const css = buildPortalThemeCss(theme);
  const body = portalSectionsHtml({
    shopName: shop,
    features: { ...PORTAL_SECTION_FEATURE_DEFAULTS, ...(opts.features ?? {}) },
    mode: "preview",
    compact: opts.compact,
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:${theme.tokens.bg2}}${css}</style></head><body>
<div id="ww-portal">${THEME_DECOR_MARKUP}
<div class="ww-wrap">
    ${body}
</div></div></body></html>`;
}
