// Extracted from FontSwitcher.jsx so this file has no non-component
// exports — react-refresh/only-export-components requires files that
// export a component to export *only* components, or Fast Refresh
// (HMR) can't reliably preserve state across edits.

/* ── Font definitions ──────────────────────────────────────────── */
export const FONTS = [
  {
    id: "inter",
    name: "Inter",
    label: "Default",
    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    google: null,
    category: "Sans-serif",
    preview: "Aa",
    desc: "Clean, modern, readable",
  },
  {
    id: "system",
    name: "System UI",
    label: "Native",
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    google: null,
    category: "Sans-serif",
    preview: "Aa",
    desc: "Native OS font, fastest",
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    label: "Geometric",
    stack: "'DM Sans', sans-serif",
    google: "DM+Sans:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Geometric, approachable",
  },
  {
    id: "poppins",
    name: "Poppins",
    label: "Friendly",
    stack: "'Poppins', sans-serif",
    google: "Poppins:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Rounded, friendly, modern",
  },
  {
    id: "nunito",
    name: "Nunito",
    label: "Soft",
    stack: "'Nunito', sans-serif",
    google: "Nunito:wght@400;500;600;700;800",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Soft rounded letters",
  },
  {
    id: "lato",
    name: "Lato",
    label: "Warm",
    stack: "'Lato', sans-serif",
    google: "Lato:wght@400;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Warm, humanist sans",
  },
  {
    id: "roboto",
    name: "Roboto",
    label: "Material",
    stack: "'Roboto', sans-serif",
    google: "Roboto:wght@400;500;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Google's Material font",
  },
  {
    id: "outfit",
    name: "Outfit",
    label: "Sharp",
    stack: "'Outfit', sans-serif",
    google: "Outfit:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Sharp, contemporary",
  },
  {
    id: "plus-jakarta",
    name: "Plus Jakarta Sans",
    label: "Premium",
    stack: "'Plus Jakarta Sans', sans-serif",
    google: "Plus+Jakarta+Sans:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Premium, enterprise-grade",
  },
  {
    id: "work-sans",
    name: "Work Sans",
    label: "Neutral",
    stack: "'Work Sans', sans-serif",
    google: "Work+Sans:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Neutral, works anywhere",
  },
  {
    id: "ibm-plex",
    name: "IBM Plex Sans",
    label: "Technical",
    stack: "'IBM Plex Sans', sans-serif",
    google: "IBM+Plex+Sans:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Technical, precise",
  },
  {
    id: "manrope",
    name: "Manrope",
    label: "Elegant",
    stack: "'Manrope', sans-serif",
    google: "Manrope:wght@400;500;600;700;800",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Elegant, semi-condensed",
  },
  {
    id: "rubik",
    name: "Rubik",
    label: "Rounded",
    stack: "'Rubik', sans-serif",
    google: "Rubik:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Slightly rounded corners",
  },
  {
    id: "sora",
    name: "Sora",
    label: "Modern",
    stack: "'Sora', sans-serif",
    google: "Sora:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Precise geometric modern",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    label: "Techy",
    stack: "'Space Grotesk', sans-serif",
    google: "Space+Grotesk:wght@400;500;600;700",
    category: "Sans-serif",
    preview: "Aa",
    desc: "Techy, unique character",
  },
  {
    id: "merriweather",
    name: "Merriweather",
    label: "Editorial",
    stack: "'Merriweather', Georgia, serif",
    google: "Merriweather:wght@400;700",
    category: "Serif",
    preview: "Aa",
    desc: "Editorial, authoritative",
  },
  {
    id: "playfair",
    name: "Playfair Display",
    label: "Luxury",
    stack: "'Playfair Display', Georgia, serif",
    google: "Playfair+Display:wght@400;500;600;700",
    category: "Serif",
    preview: "Aa",
    desc: "Luxury, high contrast",
  },
  {
    id: "lora",
    name: "Lora",
    label: "Literary",
    stack: "'Lora', Georgia, serif",
    google: "Lora:wght@400;500;600;700",
    category: "Serif",
    preview: "Aa",
    desc: "Literary, calligraphic",
  },
  {
    id: "fira-code",
    name: "Fira Code",
    label: "Code",
    stack: "'Fira Code', 'Courier New', monospace",
    google: "Fira+Code:wght@400;500;600",
    category: "Monospace",
    preview: "Aa",
    desc: "Ligatures, developer-grade",
  },
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    label: "Dev",
    stack: "'JetBrains Mono', monospace",
    google: "JetBrains+Mono:wght@400;500;600",
    category: "Monospace",
    preview: "Aa",
    desc: "Designed for long coding",
  },
];

export const CATEGORIES = ["All", "Sans-serif", "Serif", "Monospace"];

/* ── load Google Font if needed ───────────────────────────────── */
const loadedFonts = new Set(["inter", "system"]);
export function loadFont(font) {
  if (!font.google || loadedFonts.has(font.id)) return;
  loadedFonts.add(font.id);
  const link = document.createElement("link");
  link.rel  = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  document.head.appendChild(link);
}

/* ── apply font globally ──────────────────────────────────────── */
export function applyFont(font) {
  loadFont(font);
  document.documentElement.style.setProperty("--font-sans", font.stack);
  document.body.style.fontFamily = font.stack;
  localStorage.setItem("prowosma-font",      font.id);
  localStorage.setItem("prowosma-font-stack", font.stack);
}

export function initFont() {
  const id    = localStorage.getItem("prowosma-font");
  const stack = localStorage.getItem("prowosma-font-stack");
  if (id && stack) {
    const font = FONTS.find(f => f.id === id);
    if (font) { loadFont(font); }
    document.documentElement.style.setProperty("--font-sans", stack);
    document.body.style.fontFamily = stack;
  }
}
