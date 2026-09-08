import { useState, useEffect, useRef } from "react";
import { FONTS, CATEGORIES, applyFont, loadFont } from "../utils/fontUtils";

/* ── Component ────────────────────────────────────────────────── */
export default function FontSwitcher() {
  const [open,     setOpen]     = useState(false);
  const [active,   setActive]   = useState(() => localStorage.getItem("prowosma-font") || "inter");
  const [category, setCategory] = useState("All");
  const [preview,  setPreview]  = useState(null); // font being hovered
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Pre-load all fonts on mount so previews look correct
  useEffect(() => { FONTS.forEach(loadFont); }, []);

  const filtered = FONTS.filter(f => category === "All" || f.category === category);

  const handleSelect = font => {
    applyFont(font);
    setActive(font.id);
    setPreview(null);
    setOpen(false);
  };

  const handleHover = font => {
    loadFont(font);
    setPreview(font);
    // Live preview on hover — restore on mouse leave
    // eslint-disable-next-line react-hooks/immutability -- mouse-hover handler, not render
    document.body.style.fontFamily = font.stack;
  };

  const handleLeave = () => {
    setPreview(null);
    const cur = FONTS.find(f => f.id === active);
    document.body.style.fontFamily = cur?.stack || "";
  };

  const activeFont = FONTS.find(f => f.id === active) || FONTS[0];

  return (
    <div className="fs-wrap" ref={ref}>

      {/* Trigger button */}
      <button
        className="fs-trigger"
        onClick={() => setOpen(o => !o)}
        title="Change font"
      >
        <span className="fs-trigger-inner">
          <svg className="fs-trigger-icon" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 7 4 4 20 4 20 7"/>
            <line x1="9" y1="20" x2="15" y2="20"/>
            <line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
          <span className="fs-trigger-label">Font</span>
        </span>
      </button>

      {open && (
        <div className="fs-panel">

          {/* Header */}
          <div className="fs-panel-header">
            <div className="fs-panel-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/>
                <line x1="12" y1="4" x2="12" y2="20"/>
              </svg>
              Font Switcher
              <span className="fs-active-name">{activeFont.name}</span>
            </div>
            <button className="fs-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* Live preview strip */}
          <div className="fs-preview-strip">
            <div className="fs-preview-text"
              style={{ fontFamily: (preview || activeFont).stack }}>
              The quick brown fox jumps over the lazy dog
            </div>
            <div className="fs-preview-meta">
              {(preview || activeFont).name} · {(preview || activeFont).category} · {(preview || activeFont).desc}
            </div>
          </div>

          {/* Category tabs */}
          <div className="fs-cats">
            {CATEGORIES.map(c => (
              <button
                key={c}
                className={"fs-cat" + (category === c ? " active" : "")}
                onClick={() => setCategory(c)}
              >{c}</button>
            ))}
          </div>

          {/* Font list */}
          <div className="fs-list">
            {filtered.map(font => (
              <div
                key={font.id}
                className={"fs-item" + (active === font.id ? " active" : "")}
                onClick={() => handleSelect(font)}
                onMouseEnter={() => handleHover(font)}
                onMouseLeave={handleLeave} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleSelect(font))?.(e); } }}
              >
                <div className="fs-item-preview" style={{ fontFamily: font.stack }}>
                  {font.preview}
                </div>
                <div className="fs-item-info">
                  <div className="fs-item-name" style={{ fontFamily: font.stack }}>
                    {font.name}
                  </div>
                  <div className="fs-item-desc">{font.desc}</div>
                </div>
                <div className="fs-item-right">
                  <span className="fs-item-cat">{font.label}</span>
                  {active === font.id && <span className="fs-check">✓</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Reset */}
          <div className="fs-footer">
            <button className="fs-reset"
              onClick={() => handleSelect(FONTS[0])}>
              Reset to default (Inter)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
