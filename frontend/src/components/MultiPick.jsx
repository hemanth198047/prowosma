import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import "../styles/multipick.css";

/**
 * A filter button that opens a checkbox list: "Department", "Department: Design", "Department: 3".
 * Nothing ticked means no filter. Long lists get a search box. Escape or a click outside closes it.
 *
 *   <MultiPick label="Department" options={[{ value: "Design", label: "Design", hint: "4 people" }]}
 *              selected={["Design"]} onChange={(values) => ...} />
 */
export default function MultiPick({ label, options, selected, onChange, emptyText = "Nothing to choose from yet.", allLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef(null);
  const id = useId();
  const chosen = new Set(selected);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  // Opening moves focus into the list (its search box, else the first option) so keyboard users land there.
  useEffect(() => {
    if (open) box.current?.querySelector(".mp-search, .mp-opt input")?.focus();
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(t)) : options;
  }, [options, q]);

  const toggle = (v) => onChange(chosen.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const one = selected.length === 1 ? options.find((o) => o.value === selected[0]) : null;
  const summary = selected.length === 0 ? null : one ? one.label : String(selected.length);

  return (
    <div className="mp" ref={box}>
      <button type="button" className={"mp-btn" + (selected.length ? " mp-btn--on" : "")} aria-haspopup="true" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>{label}{summary ? <>: <strong>{summary}</strong></> : null}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="mp-pop" id={id} role="group" aria-label={label}>
          {options.length > 8 && (
            <input className="mp-search" type="search" placeholder={`Find ${label.toLowerCase()}…`} aria-label={`Find ${label.toLowerCase()}`}
              value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {options.length === 0 ? <p className="mp-empty">{emptyText}</p> : (
            <ul className="mp-list">
              {shown.map((o) => (
                <li key={o.value}>
                  <label className="mp-opt">
                    <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                    <span className="mp-box" aria-hidden="true">{chosen.has(o.value) ? <Check size={12} /> : null}</span>
                    <span className="mp-text"><span>{o.label}</span>{o.hint ? <small>{o.hint}</small> : null}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="mp-empty">No match.</li>}
            </ul>
          )}
          {selected.length > 0 && (
            <div className="mp-foot">
              <button type="button" className="mp-clear" onClick={() => onChange([])}>{allLabel || "Clear"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
