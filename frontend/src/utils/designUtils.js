// applyDesign() is the DOM-variable-application mechanism shared with
// the White Label feature (pages/WhiteLabel.jsx) for real per-tenant
// branding. The 50-built-in-design catalog, category list, and
// personal-skin reset/init helpers that used to live here were only
// ever consumed by the removed DesignSwitcher component and are gone
// — see the design-system redesign notes.

/* ─── Apply design to DOM ──────────────────────────────────────── */
export function applyDesign(design) {
  const root = document.documentElement;
  const body = document.body;

  // ── Helper functions ──────────────────────────────────────────
  function hex2rgb(hex) {
    const h = hex.replace('#','');
    if (h.length < 6) return [128,128,128];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgba(hex, a) {
    try { const [r,g,b] = hex2rgb(hex); return "rgba("+r+","+g+","+b+","+a+")"; }
    catch { return hex; }
  }
  const brand     = design.brand      || "#6366f1";
  const brandDark = design.brandDark  || brand;
  const brandLight= design.brandLight || rgba(brand, 0.15);
  const card      = design.card       || "#ffffff";
  const cardBdr   = design.cardBorder || "#e2e8f0";
  const text      = design.text       || "#1e293b";
  const textMuted = design.textMuted  || "#64748b";
  const topbar    = design.topbar     || "#ffffff";
  const topbarBdr = design.topbarBorder || cardBdr;
  // Detect dark designs properly
  const DARK_IDS = new Set(["midnight","dracula","monokai","nord","one-dark","abyss",
    "charcoal","neon-blue","neon-green","neon-purple","neon-orange","neon-pink",
    "neon-coral","retro-80s","retro-terminal","retro-amber","vaporwave"]);
  const isDark = design.category === "Dark" || design.category === "Neon"
    || DARK_IDS.has(design.id)
    || (design.bg && (design.bg.includes("0f172a") || design.bg.includes("020817")
        || design.bg.includes("000814") || design.bg.includes("001100")))
    || (design.sidebar && (design.sidebar.startsWith("#0") || design.sidebar.startsWith("#1")
        || design.sidebar.startsWith("#2") || design.sidebar.includes("rgba(0")
        || design.sidebar.includes("rgba(1")));

  // Derive gray scale from text colour so it's always readable
  const grayScale = isDark ? {
    "50":"rgba(255,255,255,0.04)","100":"rgba(255,255,255,0.08)",
    "200":"rgba(255,255,255,0.12)","300":"rgba(255,255,255,0.25)",
    "400":"rgba(255,255,255,0.45)","500":"rgba(255,255,255,0.6)",
    "600":"rgba(255,255,255,0.72)","700":"rgba(255,255,255,0.82)",
    "800":"rgba(255,255,255,0.92)","900":"rgba(255,255,255,0.97)",
  } : {
    "50":"#f8fafc","100":"#f1f5f9","200":"#e2e8f0","300":"#cbd5e1",
    "400":"#94a3b8","500":"#64748b","600":"#475569","700":"#334155",
    "800":"#1e293b","900":"#0f172a",
  };

  // ── 1. Brand colours ──────────────────────────────────────────────
  root.style.setProperty("--brand-500",   brand);
  root.style.setProperty("--brand-600",   brandDark);
  root.style.setProperty("--brand-700",   brandDark);
  root.style.setProperty("--brand-50",    brandLight);
  root.style.setProperty("--brand-100",   brandLight);
  root.style.setProperty("--accent-500",  brand);
  root.style.setProperty("--accent-600",  brandDark);
  root.style.setProperty("--ds-brand",    brand);

  // ── 2. Gray scale (adapts to light/dark) ─────────────────────────
  Object.entries(grayScale).forEach(([k,v]) => root.style.setProperty("--gray-"+k, v));

  // ── 3. Page & card backgrounds ───────────────────────────────────
  const pageBg = (design.bg && (design.bg.includes("http")||design.bg.startsWith("linear")))
    ? (design.bgFallback || "#0f172a") : (design.bg || "#f8fafc");
  root.style.setProperty("--bg-page",     pageBg);
  root.style.setProperty("--bg-card",     card);
  root.style.setProperty("--bg-input",    card);
  root.style.setProperty("--border",      cardBdr);

  // For scenic/image designs: use semi-transparent frosted cards
  const isImageDesign = design.bg && (design.bg.includes("http") || design.bg.includes("unsplash"));
  const isGlassDesign = !!design.isGlass || design.category === "Glassmorphism";
  const effectiveCard  = isImageDesign ? "rgba(255,255,255,0.88)"
                       : isGlassDesign ? card
                       : card;
  const effectiveBdr   = isImageDesign ? "rgba(255,255,255,0.5)" : cardBdr;
  const effectiveShadow = isImageDesign
    ? "0 4px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)"
    : (design.shadow || "0 1px 3px rgba(0,0,0,0.08)");

  root.style.setProperty("--card-bg",     effectiveCard);
  root.style.setProperty("--card-border", effectiveBdr);
  root.style.setProperty("--card-shadow", effectiveShadow);

  // Text must be dark for scenic designs (image bg can be any colour)
  // For dark designs: ensure text is bright (use design.text which is already light)
  // For image designs: force dark text for readability on light frosted glass
  const effectiveText      = isImageDesign ? "#1e293b" : text;
  const effectiveTextMuted = isImageDesign ? "#475569" : textMuted;

  // ── 4. Sidebar ────────────────────────────────────────────────────
  root.style.setProperty("--sidebar-bg",          design.sidebar);
  root.style.setProperty("--sidebar-text",        design.sidebarText);
  root.style.setProperty("--sidebar-active-bg",   design.sidebarActive);
  root.style.setProperty("--sidebar-active-text", design.sidebarActiveText);
  root.style.setProperty("--sidebar-label",       design.sidebarLabel);

  // ── 5. Topbar ─────────────────────────────────────────────────────
  root.style.setProperty("--topbar-bg",    topbar);

  // ── 6. Typography ─────────────────────────────────────────────────
  root.style.setProperty("--text-primary", effectiveText);
  root.style.setProperty("--text-muted",   effectiveTextMuted);
  root.style.setProperty("--gray-800",     effectiveText);
  root.style.setProperty("--gray-900",     effectiveText);
  root.style.setProperty("--gray-500",     effectiveTextMuted);
  root.style.setProperty("--color-text-primary",    effectiveText);
  root.style.setProperty("--color-text-secondary",  effectiveTextMuted);
  root.style.setProperty("--color-text-tertiary",   grayScale["400"]);
  root.style.setProperty("--color-background-primary",   effectiveCard);
  root.style.setProperty("--color-background-secondary", pageBg);
  root.style.setProperty("--font-sans",    design.font || "Inter, system-ui, sans-serif");
  body.style.fontFamily = design.font || "Inter, system-ui, sans-serif";

  // ── 7. Border radius ─────────────────────────────────────────────
  root.style.setProperty("--radius-sm",   design.radius    || "6px");
  root.style.setProperty("--radius-md",   design.radius    || "8px");
  root.style.setProperty("--radius-lg",   design.radiusLg  || "14px");
  root.style.setProperty("--radius-xl",   design.radiusLg  || "18px");
  root.style.setProperty("--radius-full", design.radiusFull|| "9999px");
  root.style.setProperty("--border-radius-md", design.radius   || "8px");
  root.style.setProperty("--border-radius-lg", design.radiusLg || "14px");

  // ── 8. Inputs & search ────────────────────────────────────────────
  root.style.setProperty("--input-bg",      design.searchBg  || card);
  root.style.setProperty("--input-border",  design.searchBorder || cardBdr);
  root.style.setProperty("--search-bg",     design.searchBg  || grayScale["100"]);
  root.style.setProperty("--search-border", design.searchBorder || cardBdr);

  // ── 9. Buttons ───────────────────────────────────────────────────
  root.style.setProperty("--btn-primary-bg",   design.btnPrimary || brand);
  root.style.setProperty("--btn-primary-text", design.btnPrimaryText || "#fff");

  // ── 10. AI insight card — adapts based on design darkness ─────────
  if (isDark || design.id?.includes("dark") || design.id?.includes("night")
      || design.id?.includes("neon") || design.id?.includes("3d")
      || design.id?.includes("abyss") || design.id?.includes("dracula")
      || design.id?.includes("monokai") || design.id?.includes("nord")
      || design.category === "Dark" || design.category === "Neon"
      || design.category === "3D" || design.category === "Scenic") {
    // Keep the dramatic dark card for dark themes
    root.style.setProperty("--ai-card-bg",
      "linear-gradient(160deg,rgba(0,0,0,0.6) 0%,rgba(0,0,20,0.7) 100%)");
    root.style.setProperty("--ai-card-border", rgba(brand, 0.4));
    root.style.setProperty("--ai-card-text",   "#fff");
    root.style.setProperty("--ai-card-btn",    "linear-gradient(135deg,"+brand+" 0%,"+brandDark+" 100%)");
  } else {
    // Light themes: use a gentle brand-tinted card
    root.style.setProperty("--ai-card-bg",
      "linear-gradient(160deg,"+rgba(brand,0.06)+" 0%,"+rgba(brandDark,0.1)+" 100%)");
    root.style.setProperty("--ai-card-border", rgba(brand, 0.25));
    root.style.setProperty("--ai-card-text",   text);
    root.style.setProperty("--ai-card-btn",    "linear-gradient(135deg,"+brand+" 0%,"+brandDark+" 100%)");
  }

  // ── 11. Shadows ───────────────────────────────────────────────────
  root.style.setProperty("--shadow-xs", design.shadow || "0 1px 2px rgba(0,0,0,0.05)");
  root.style.setProperty("--shadow-sm", design.shadow || "0 1px 3px rgba(0,0,0,0.08)");
  root.style.setProperty("--shadow-md", design.shadow || "0 4px 12px rgba(0,0,0,0.1)");
  root.style.setProperty("--shadow-lg", design.shadow || "0 8px 24px rgba(0,0,0,0.12)");

  // ── 12. Body background ───────────────────────────────────────────
  if (design.bg) {
    const isImg      = design.bg.includes("http") || design.bg.includes("unsplash");
    const isGradient = design.bg.startsWith("linear") || design.bg.startsWith("radial");
    if (isImg) {
      body.style.backgroundImage    = "url('" + design.bg + "')";
      body.style.backgroundSize     = "cover";
      body.style.backgroundPosition = "center";
      body.style.backgroundAttachment = "fixed";
      body.style.backgroundColor   = design.bgFallback || "#0f172a";
    } else if (isGradient) {
      body.style.backgroundImage = design.bg;
      body.style.backgroundColor = design.bgFallback || "#0f172a";
    } else {
      body.style.backgroundImage = "";
      body.style.backgroundColor = design.bg;
    }
  }

  // ── 13. Targeted CSS overrides for all elements ──────────────────
  let el = document.getElementById("ds-overrides");
  if (!el) {
    el = document.createElement("style");
    el.id = "ds-overrides";
    document.head.appendChild(el);
  }

  const btnPrimary = design.btnPrimary || brand;
  const btnPriText = design.btnPrimaryText || "#fff";
  const isImage    = isImageDesign;

  // Card background: for image/scenic designs use semi-transparent overlay
  // For glass designs use the glass card value
  // For solid designs use the card colour directly
  const cardBgOverride = effectiveCard;

  const cardBdrOverride = effectiveBdr;

  const textOverride    = effectiveText;
  const textMutedOvr    = effectiveTextMuted;
  const hubTileBg       = effectiveCard;
  const heroBg          = effectiveCard;
  const sectionBg       = effectiveCard;
  const statBg          = isImage ? "rgba(255,255,255,0.7)" : grayScale["50"];
  const topbarBgOvr     = isImage ? "rgba(255,255,255,0.85)" : topbar;
  const sidebarBgOvr    = isImage
    ? design.sidebar   // sidebar already has opacity set per design
    : design.sidebar;

  el.textContent = [
    "/* DS targeted overrides */",

    // ── Sidebar ──
    ".sidebar { background: " + sidebarBgOvr + " !important; backdrop-filter: blur(12px) !important; }",
    ".sidebar a, .sidebar .sidebar-nav a { color: " + design.sidebarText + " !important; }",
    ".sidebar a.active, .sidebar a[aria-current='page'] { background: " + design.sidebarActive + " !important; color: " + design.sidebarActiveText + " !important; }",
    ".sidebar-section-label,.sidebar-group-label,[class*='sidebar-label'] { color: " + design.sidebarLabel + " !important; }",
    ".sidebar-group-icon { color: " + design.sidebarText + " !important; }",
    ".workspace-name,.workspace-label { color: " + design.sidebarText + " !important; }",

    // ── Topbar ──
    // ── Topbar: background only, children untouched ──
    ".topbar { background: " + topbarBgOvr + " !important; border-color: " + topbarBdr + " !important; }",

    // For dark designs: make topbar buttons subtle (not noisy coloured)
    isDark ? [
      // Search bar — subtle glass look
      ".topbar-search-btn { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.5) !important; }",
      ".topbar-search-kbd { background: rgba(255,255,255,0.1) !important; color: rgba(255,255,255,0.5) !important; }",
      // Design/Font/Help buttons — keep them neutral, NOT brand-coloured
      ".topbar-right-cluster button:not(.upgrade-btn):not([class*='upgrade']) { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.75) !important; }",
      ".topbar-right-cluster a:not(.upgrade-btn) { color: rgba(255,255,255,0.75) !important; }",
      // Moon/sun toggle
      ".theme-toggle-btn { color: rgba(255,255,255,0.6) !important; }",
      // Date/time text
      ".topbar-clock, .topbar-date, [class*='clock'], [class*='date'] { color: rgba(255,255,255,0.8) !important; }",
      // Right cluster dividers
      ".topbar-divider-v { background: rgba(255,255,255,0.1) !important; }",
      // Live dot — keep it green
      ".ws-status { background: rgba(16,185,129,0.1) !important; border-color: rgba(16,185,129,0.2) !important; }",
    ].join("\n") : [
      // Light designs: restore natural topbar button colours
      ".topbar-search-btn { background: var(--gray-50) !important; border-color: var(--border) !important; }",
      ".topbar-right-cluster button:not(.upgrade-btn) { background: transparent !important; }",
    ].join("\n"),

    // ── Buttons ──
    ".btn-primary { background: " + btnPrimary + " !important; color: " + btnPriText + " !important; border-color: " + btnPrimary + " !important; }",

    // ── Cards & sections — CRITICAL for scenic designs ──
    ".cc3-section-card,.cc3-proj-goals-row .cc3-section-card { background: " + sectionBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-hero { background: " + heroBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-hub-tile { background: " + hubTileBg + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-chart-wrap { background: " + cardBgOverride + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".cc3-mini-stat { background: " + statBg + " !important; }",
    ".project-card,.task-row,.goal-card,.card { background: " + cardBgOverride + " !important; border-color: " + cardBdrOverride + " !important; backdrop-filter: blur(8px) !important; }",
    ".bg-card { background: " + cardBgOverride + " !important; }",
    ".status-strip-wrap { background: rgba(255,255,255," + (isImage?"0.75":"0") + ") !important; backdrop-filter: " + (isImage?"blur(8px)":"none") + " !important; }",

    // ── Typography — ALL text must be readable ──
    // Set page text color only on content area, NOT on topbar
    ".content-wrapper, .page-content, main { color: " + textOverride + "; }",
    "h1,h2,h3,h4,h5,h6 { color: " + textOverride + " !important; }",
    ".cc3-hero-greeting,.cc3-hero-date { color: " + textOverride + " !important; }",
    ".cc3-hero-date { opacity: 0.75; }",
    ".cc3-hub-tile-name { color: " + textOverride + " !important; }",
    ".cc3-hub-tile-label { color: " + textMutedOvr + " !important; }",
    ".cc3-item-name { color: " + textOverride + " !important; }",
    ".cc3-item-pct { color: " + textMutedOvr + " !important; }",
    ".cc3-section-title,.page-header-title { color: " + textOverride + " !important; }",
    "[class*='-title']:not([class*='badge']):not([class*='btn']) { color: " + textOverride + " !important; }",
    ".cc3-chart-title { color: " + textMutedOvr + " !important; }",
    ".cc3-compact-item span,.cc3-compact-item div { color: " + textMutedOvr + " !important; }",
    ".cc3-section-hdr,[class*='section-label'],[class*='group-label'] { color: " + textMutedOvr + " !important; }",
    // dark-specific: make card text light WITHOUT touching topbar
    (isDark ? [
      ".cc3-section-card, .cc3-hub-tile, .project-card { color: " + textOverride + "; }",
      ".cc3-section-card *:not(button):not(.badge):not([class*='btn']):not(svg):not([class*='topbar']) { color: inherit; }",
    ].join("\n") : ""),

    // ── Status strip (text must be visible) ──
    ".cc3-status-strip span { color: " + textOverride + " !important; }",

    // ── Search ──
    ".topbar input,.search-bar input { background: " + (design.searchBg || grayScale["100"]) + " !important; border-color: " + (design.searchBorder || cardBdr) + " !important; color: " + textOverride + " !important; }",

    // ── ScrollBars ──
    "::-webkit-scrollbar-track { background: " + grayScale["50"] + " !important; }",
    "::-webkit-scrollbar-thumb { background: " + grayScale["300"] + " !important; }",
  ].join("\n");

  // ── 14. Signal dark mode via data attribute (layout.css reads [data-theme="dark"]) ──
  if (isDark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  // ── 15. Persist ───────────────────────────────────────────────────
  localStorage.setItem("prowosma-design",      design.id);
  localStorage.setItem("prowosma-design-data", JSON.stringify(design));
}
