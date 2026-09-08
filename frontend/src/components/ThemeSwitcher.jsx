import { useState, useEffect, useRef } from "react";
import { THEMES, applyTheme } from "../utils/themeUtils";

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState(
    () => localStorage.getItem("prowosma-theme") || "ocean",
  );
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelectTheme = (theme) => {
    applyTheme(theme);
    setActiveTheme(theme.id);
    setOpen(false);
  };

  return (
    <div className="theme-switcher-wrapper" ref={ref}>
      <button
        className="theme-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        title="Change theme"
      >
        🎨
      </button>

      {open && (
        <div className="theme-switcher-panel">
          <div className="theme-switcher-header">Choose Theme</div>
          <div className="theme-switcher-grid">
            {THEMES.map((theme) => (
              <div
                key={theme.id}
                className={`theme-card ${activeTheme === theme.id ? "active" : ""}`}
                onClick={() => handleSelectTheme(theme)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleSelectTheme(theme))?.(e); } }}
              >
                <div className="theme-swatches">
                  {theme.colors.map((c, i) => (
                    <div
                      key={i}
                      className="theme-swatch"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="theme-card-name">{theme.name}</div>
                <div className="theme-card-desc">{theme.description}</div>
                {activeTheme === theme.id && (
                  <div className="theme-card-active-badge">✓ Active</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
