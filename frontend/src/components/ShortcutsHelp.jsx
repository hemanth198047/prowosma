/**
 * ShortcutsHelp — shows keyboard shortcut reference (triggered by ?)
 */
import { useEffect } from "react";

const SHORTCUTS = [
  { keys: ["⌘", "K"],   desc: "Open command palette" },
  { keys: ["?"],         desc: "Show this help" },
  { keys: ["N"],         desc: "New task" },
  { keys: ["Esc"],       desc: "Close modal / palette" },
  { section: "Navigate (press G then…)" },
  { keys: ["G", "D"],   desc: "Dashboard" },
  { keys: ["G", "T"],   desc: "Tasks" },
  { keys: ["G", "P"],   desc: "Projects" },
  { keys: ["G", "G"],   desc: "Goals" },
  { keys: ["G", "K"],   desc: "Kanban" },
  { keys: ["G", "A"],   desc: "Analytics" },
  { keys: ["G", "R"],   desc: "Reports" },
  { keys: ["G", "C"],   desc: "Calendar" },
  { keys: ["G", "L"],   desc: "Activity Log" },
  { keys: ["G", "M"],   desc: "Team" },
];

export default function ShortcutsHelp({ onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape" || e.key === "?") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="cp-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()} role="presentation">
        <div className="shortcuts-header">
          <span>Keyboard Shortcuts</span>
          <button className="cp-clear" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s, i) =>
            s.section ? (
              <div key={i} className="shortcuts-section">{s.section}</div>
            ) : (
              <div key={i} className="shortcuts-row">
                <div className="shortcuts-keys">
                  {s.keys.map((k, ki) => (
                    <span key={ki}><kbd className="shortcuts-kbd">{k}</kbd>{ki < s.keys.length - 1 && " "}</span>
                  ))}
                </div>
                <span className="shortcuts-desc">{s.desc}</span>
              </div>
            )
          )}
        </div>
        <div className="cp-footer" style={{ borderTop:"1px solid var(--border)", marginTop:"4px" }}>
          <span>Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
