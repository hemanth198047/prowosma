import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

/**
 * A small "⋯" (or labelled) menu of actions.
 *
 * items: [{ label, icon?: LucideIcon, onSelect, danger?, hidden?, checked? }]
 *        or "divider". Hidden items are dropped.
 *
 * The list renders in a portal with fixed positioning, so a card with a
 * transform or overflow:hidden can't clip or offset it. Keyboard: Enter/Space
 * or ArrowDown opens, arrows move, Home/End jump, Esc closes and returns focus.
 */
export default function ActionMenu({ items, label = "More actions", children, className = "", align = "end" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const visible = items.filter(i => i === "divider" || !i.hidden);
  // no leading/trailing/double dividers
  const shown = visible.filter((i, idx) => i !== "divider" || (idx > 0 && idx < visible.length - 1 && visible[idx - 1] !== "divider"));

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight || 0;
      const menuW = menuRef.current?.offsetWidth || 200;
      const below = r.bottom + 4 + menuH <= window.innerHeight - 8;
      let left = align === "end" ? r.right - menuW : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
      setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - menuH), left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onMenuKey = (e) => {
    const els = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const i = els.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") { close(false); }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`am-trigger ${children ? "am-trigger--text" : ""} ${className}`.trim()}
        aria-label={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {children ?? <MoreHorizontal size={16} aria-hidden="true" />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          className="am-menu"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          onKeyDown={onMenuKey}
          onClick={(e) => e.stopPropagation()}
        >
          {shown.map((item, idx) => item === "divider"
            ? <div key={`d${idx}`} className="am-divider" role="separator" />
            : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`am-item${item.danger ? " am-item--danger" : ""}`}
                onClick={() => { close(); item.onSelect?.(); }}
              >
                {item.icon && <item.icon size={15} aria-hidden="true" className="am-icon" />}
                <span>{item.label}</span>
              </button>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}
