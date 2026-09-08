import { useState, useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════════
   DESIGN DEFINITIONS — 50 built-in designs
   Each design controls: sidebar, topbar, cards, fonts, border-radius,
   spacing, shadows — a complete visual language, not just colour.
   Categories: Professional · Playful · Dark · Nature · Minimal ·
                Glassmorphism · Retro · Neon
   ═══════════════════════════════════════════════════════════════════ */
import { BUILT_IN_DESIGNS, CATEGORIES, applyDesign, resetToDefault } from "../utils/designUtils";




/* ─── Component ────────────────────────────────────────────────── */
export default function DesignSwitcher() {
  const [open,      setOpen]      = useState(false);
  const [category,  setCategory]  = useState("All");
  const [search,    setSearch]    = useState("");
  const [active,    setActive]    = useState(() => localStorage.getItem("prowosma-design") || "corp-blue");
  const [showCustom,setShowCustom]= useState(false);
  const [customForm, setCustomForm] = useState({
    name:"", sidebar:"#1e293b", sidebarText:"rgba(255,255,255,0.7)",
    sidebarActive:"#6366f1", sidebarActiveText:"#fff", sidebarLabel:"rgba(255,255,255,0.3)",
    topbar:"#ffffff", topbarBorder:"#e2e8f0", topbarText:"#1e293b",
    brand:"#6366f1", brandLight:"#eef2ff", brandDark:"#4f46e5",
    bg:"#f8fafc", card:"#ffffff", cardBorder:"#e2e8f0",
    shadow:"0 2px 8px rgba(0,0,0,0.08)",
    text:"#1e293b", textMuted:"#64748b",
    accent:"#6366f1", accentText:"#fff",
    searchBg:"#f1f5f9", searchBorder:"#e2e8f0",
    btnPrimary:"#6366f1", btnPrimaryText:"#fff",
    badge:"#eef2ff", badgeText:"#4338ca",
    radius:"8px", radiusLg:"16px", radiusFull:"9999px",
    font:"Inter, system-ui, sans-serif",
  });
  const [customDesigns, setCustomDesigns] = useState(() =>
    JSON.parse(localStorage.getItem("prowosma-custom-designs") || "[]")
  );

  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const allDesigns = [...BUILT_IN_DESIGNS, ...customDesigns.map(d => ({ ...d, category: "Custom" }))];

  const filtered = allDesigns.filter(d => {
    const catMatch = category === "All" || d.category === category;
    const searchMatch = !search || d.name.toLowerCase().includes(search.toLowerCase());
    return catMatch && searchMatch;
  });

  const handleSelect = (d) => {
    applyDesign(d);
    setActive(d.id);
    setOpen(false);
  };

  const saveCustomDesign = () => {
    if (!customForm.name.trim()) return;
    const d = { ...customForm, id: "custom-" + Date.now(), preview: [customForm.brand, customForm.sidebar, customForm.topbar, customForm.card, customForm.accent] };
    const next = [...customDesigns, d];
    setCustomDesigns(next);
    localStorage.setItem("prowosma-custom-designs", JSON.stringify(next));
    handleSelect(d);
    setShowCustom(false);
  };

  const deleteCustom = (id, e) => {
    e.stopPropagation();
    const next = customDesigns.filter(d => d.id !== id);
    setCustomDesigns(next);
    localStorage.setItem("prowosma-custom-designs", JSON.stringify(next));
  };

  const cfSet = (k, v) => setCustomForm(f => ({ ...f, [k]: v }));

  return (
    <div className="ds-wrapper" ref={ref}>
      {/* Trigger button */}
      <button className="ds-trigger" onClick={() => setOpen(o => !o)} title="Design Switcher">
        {/* Paint palette — colourful dot cluster makes it unmistakable */}
        <span className="ds-trigger-inner">
          <svg className="ds-trigger-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Palette body */}
            <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.1 0 2-.9 2-2 0-.53-.2-1.01-.52-1.38-.31-.36-.49-.83-.49-1.32 0-1.1.9-2 2-2h2.34C19.87 15.3 22 13.79 22 12c0-5.52-4.48-10-10-10z" fill="currentColor" opacity="0.12"/>
            <path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.1 0 2-.9 2-2 0-.53-.2-1.01-.52-1.38-.31-.36-.49-.83-.49-1.32 0-1.1.9-2 2-2h2.34C19.87 15.3 22 13.79 22 12c0-5.52-4.48-10-10-10z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* Colour dots on palette */}
            <circle cx="6.5"  cy="11.5" r="1.5" fill="#ef4444"/>
            <circle cx="8.5"  cy="7.5"  r="1.5" fill="#f97316"/>
            <circle cx="12.5" cy="6"    r="1.5" fill="#eab308"/>
            <circle cx="16"   cy="8.5"  r="1.5" fill="#22c55e"/>
            <circle cx="17.5" cy="12.5" r="1.5" fill="#6366f1"/>
          </svg>
          <span className="ds-trigger-label">Design</span>
        </span>
      </button>

      {open && (
        <div className="ds-panel">
          {/* Header */}
          <div className="ds-panel-header">
            <div className="ds-panel-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.1 0 2-.9 2-2 0-.53-.2-1.01-.52-1.38-.31-.36-.49-.83-.49-1.32 0-1.1.9-2 2-2h2.34C19.87 15.3 22 13.79 22 12c0-5.52-4.48-10-10-10z" fill="currentColor" opacity="0.15"/><path d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10 1.1 0 2-.9 2-2 0-.53-.2-1.01-.52-1.38-.31-.36-.49-.83-.49-1.32 0-1.1.9-2 2-2h2.34C19.87 15.3 22 13.79 22 12c0-5.52-4.48-10-10-10z" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="6.5" cy="11.5" r="1.5" fill="#ef4444"/><circle cx="8.5" cy="7.5" r="1.5" fill="#f97316"/><circle cx="12.5" cy="6" r="1.5" fill="#eab308"/><circle cx="16" cy="8.5" r="1.5" fill="#22c55e"/><circle cx="17.5" cy="12.5" r="1.5" fill="#6366f1"/></svg>
              Design Switcher
              <span className="ds-count">{allDesigns.length} designs</span>
            </div>
            <div className="ds-header-actions">
              <button className="ds-reset-btn" onClick={() => {
                resetToDefault();
                setActive("default");
                setOpen(false);
              }} title="Reset to default design">↺ Default</button>
              <button className="ds-custom-btn" onClick={() => setShowCustom(v => !v)}>
                {showCustom ? "← Browse" : "+ Custom"}
              </button>
              <button className="ds-close" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          {!showCustom ? (
            <>
              {/* Search */}
              <div className="ds-search-wrap">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input className="ds-search" placeholder="Search designs…" value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button className="ds-search-clear" onClick={() => setSearch("")}>✕</button>}
              </div>

              {/* Category tabs */}
              <div className="ds-cats">
                {CATEGORIES.map(c => (
                  <button key={c} className={"ds-cat" + (category === c ? " active" : "")} onClick={() => setCategory(c)}>
                    {c} {c !== "All" && c !== "Custom" ? <span className="ds-cat-count">{allDesigns.filter(d=>d.category===c).length}</span> : null}
                    {c === "Custom" ? <span className="ds-cat-count">{customDesigns.length}</span> : null}
                  </button>
                ))}
              </div>

              {/* Design grid */}
              <div className="ds-grid">
                {filtered.length === 0 && (
                  <div className="ds-empty">No designs found. <button onClick={() => setShowCustom(true)}>Create one?</button></div>
                )}
                {filtered.map(d => (
                  <div key={d.id} className={"ds-card" + (active === d.id ? " active" : "")} onClick={() => handleSelect(d)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleSelect(d))?.(e); } }}>
                    {/* Preview swatches */}
                    <div className="ds-preview">
                      {(d.preview || []).slice(0,5).map((c, i) => (
                        <div key={i} className="ds-swatch" style={{ background: c }} />
                      ))}
                    </div>
                    {/* Mini layout preview */}
                    <div className="ds-mini-layout">
                      <div className="ds-mini-sidebar" style={{ background: d.sidebar }}>
                        {[1,2,3].map(i => <div key={i} className="ds-mini-item" style={{ background: d.sidebarText, opacity: i===1?0.8:0.4 }} />)}
                      </div>
                      <div className="ds-mini-main">
                        <div className="ds-mini-topbar" style={{ background: d.topbar, borderBottom: `1px solid ${d.topbarBorder}` }} />
                        <div className="ds-mini-content" style={{
                          background: (d.bg && (d.bg.includes("unsplash") || d.bg.startsWith("http")))
                            ? `url('${d.bg}') center/cover`
                            : (d.bg && d.bg.startsWith("linear")) ? d.bg : (d.bg || "#f8fafc"),
                          backgroundSize: "cover",
                        }}>
                          <div className="ds-mini-card" style={{ background: d.card, border: `1px solid ${d.cardBorder}` }} />
                          <div className="ds-mini-card" style={{ background: d.card, border: `1px solid ${d.cardBorder}` }} />
                        </div>
                      </div>
                    </div>
                    <div className="ds-card-info">
                      <div className="ds-card-name">{d.name}</div>
                      <div className="ds-card-cat">{d.category}</div>
                    </div>
                    {active === d.id && <div className="ds-active-badge">✓ Active</div>}
                    {d.category === "Custom" && (
                      <button className="ds-delete-btn" onClick={e => deleteCustom(d.id, e)} title="Delete">✕</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Custom Design Builder */
            <div className="ds-custom-form">
              <div className="ds-custom-title">✏️ Create Custom Design</div>
              <div className="ds-custom-name-row">
                <label htmlFor={"design-switcher-design-name"}>Design Name</label>
                <input className="ds-custom-input" value={customForm.name} onChange={e => cfSet("name", e.target.value)} placeholder="My Custom Design" id={"design-switcher-design-name"} />
              </div>

              {/* Live preview */}
              <div className="ds-live-preview">
                <div className="ds-lp-sidebar" style={{ background: customForm.sidebar }}>
                  <div style={{ height: 3, width: "70%", background: customForm.sidebarText, opacity: 0.7, borderRadius: 2, marginBottom: 4 }} />
                  <div style={{ height: 3, width: "50%", background: customForm.sidebarActive, borderRadius: 2, marginBottom: 4 }} />
                  <div style={{ height: 3, width: "60%", background: customForm.sidebarText, opacity: 0.4, borderRadius: 2 }} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <div className="ds-lp-topbar" style={{ background: customForm.topbar, borderBottom: `1px solid ${customForm.topbarBorder}` }}>
                    <div style={{ height: 4, flex: 1, background: customForm.searchBg, borderRadius: 3, border: `1px solid ${customForm.searchBorder}` }} />
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: customForm.brand, marginLeft: 6 }} />
                  </div>
                  <div style={{ flex: 1, background: customForm.bg, padding: 5, display: "flex", gap: 4 }}>
                    <div style={{ flex: 1, background: customForm.card, border: `1px solid ${customForm.cardBorder}`, borderRadius: 4 }} />
                    <div style={{ flex: 1, background: customForm.card, border: `1px solid ${customForm.cardBorder}`, borderRadius: 4 }} />
                  </div>
                </div>
              </div>

              <div className="ds-custom-grid">
                {[
                  ["Sidebar", "sidebar"], ["Sidebar Text", "sidebarText"],
                  ["Sidebar Active", "sidebarActive"], ["Topbar", "topbar"],
                  ["Topbar Text", "topbarText"], ["Brand", "brand"],
                  ["Background", "bg"], ["Card", "card"],
                  ["Card Border", "cardBorder"], ["Primary Text", "text"],
                  ["Muted Text", "textMuted"], ["Accent", "accent"],
                  ["Button Primary", "btnPrimary"], ["Search BG", "searchBg"],
                ].map(([label, key]) => (
                  <div key={key} className="ds-custom-field">
                    <label>{label}</label>
                    <div className="ds-color-row">
                      <input type="color" value={customForm[key]?.startsWith?.("rgba") ? "#6366f1" : customForm[key] || "#6366f1"}
                        onChange={e => cfSet(key, e.target.value)} className="ds-color-input" />
                      <input className="ds-custom-input ds-text-input" value={customForm[key] || ""}
                        onChange={e => cfSet(key, e.target.value)} placeholder="color or rgba()" />
                    </div>
                  </div>
                ))}
                <div className="ds-custom-field">
                  <label htmlFor={"design-switcher-border-radius"}>Border Radius</label>
                  <input className="ds-custom-input" value={customForm.radius} onChange={e => cfSet("radius", e.target.value)} placeholder="8px" id={"design-switcher-border-radius"} />
                </div>
                <div className="ds-custom-field">
                  <label htmlFor={"design-switcher-font"}>Font</label>
                  <select className="ds-custom-input" value={customForm.font} onChange={e => cfSet("font", e.target.value)} id={"design-switcher-font"}>
                    <option value="Inter, system-ui, sans-serif">Inter</option>
                    <option value="'Poppins', sans-serif">Poppins</option>
                    <option value="'Nunito', sans-serif">Nunito</option>
                    <option value="'DM Sans', sans-serif">DM Sans</option>
                    <option value="'Lato', sans-serif">Lato</option>
                    <option value="'Merriweather', serif">Merriweather</option>
                    <option value="'Playfair Display', serif">Playfair Display</option>
                    <option value="'IBM Plex Mono', monospace">IBM Plex Mono</option>
                    <option value="'Courier New', monospace">Courier New</option>
                    <option value="'Orbitron', sans-serif">Orbitron</option>
                  </select>
                </div>
              </div>

              <div className="ds-custom-actions">
                <button className="ds-save-btn" onClick={saveCustomDesign} disabled={!customForm.name.trim()}>
                  💾 Save &amp; Apply Design
                </button>
                <button className="ds-cancel-btn" onClick={() => setShowCustom(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}