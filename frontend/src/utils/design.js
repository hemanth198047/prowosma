/**
 * Classic / New design switch. Both designs share one codebase; the Classic look is a generated stylesheet
 * (styles/classic.css, see scripts/build-classic-css.mjs) whose rules only apply under html[data-design="classic"].
 * It is downloaded only when someone picks Classic, so the New design pays nothing for it.
 *
 * The choice is per browser (localStorage). A link with ?design=classic or ?design=new switches and remembers it,
 * which is handy for showing a client both versions.
 */
export const DESIGNS = { NEW: "new", CLASSIC: "classic" };
const KEY = "prowosma.design";
export const DESIGN_CHANGED_EVENT = "prowosma:design-changed";

let classicLoaded = null;
const loadClassic = () => (classicLoaded ||= import("../styles/classic.css"));

const valid = (d) => (d === DESIGNS.CLASSIC || d === DESIGNS.NEW ? d : null);

function stored() {
  try { return valid(localStorage.getItem(KEY)); } catch { return null; }
}

/** The design to use now: ?design= first (and remembered), then the saved choice, then New. */
export function currentDesign() {
  let fromUrl = null;
  try { fromUrl = valid(new URLSearchParams(window.location.search).get("design")); } catch { /* no window */ }
  if (fromUrl) {
    try { localStorage.setItem(KEY, fromUrl); } catch { /* private mode */ }
    // Remembered now, so drop it from the address: a later switch in the menu must survive a reload.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("design");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* no history API */ }
    return fromUrl;
  }
  return stored() || DESIGNS.NEW;
}

/**
 * Applies a design. For Classic the stylesheet is loaded first and the attribute set afterwards, so the page
 * never shows half of each design.
 */
export async function applyDesign(design, { remember = true } = {}) {
  const d = valid(design) || DESIGNS.NEW;
  if (remember) { try { localStorage.setItem(KEY, d); } catch { /* private mode */ } }
  const root = document.documentElement;
  if (d === DESIGNS.CLASSIC) {
    try { await loadClassic(); } catch { root.dataset.design = DESIGNS.NEW; return DESIGNS.NEW; }
  }
  root.dataset.design = d;
  window.dispatchEvent(new CustomEvent(DESIGN_CHANGED_EVENT, { detail: d }));
  return d;
}

export const activeDesign = () => valid(document.documentElement.dataset.design) || DESIGNS.NEW;
