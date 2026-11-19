import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import "../styles/people-picker.css";

const initials = (name = "?") => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

/**
 * Pick people by typing a few letters of their name or email and choosing from the list - no typing names out.
 *   people:   [{ key, name, email }]   everyone who can be picked
 *   value:    [key]                    who is picked
 *   onChange: (keys) => void
 *   exclude:  [key]                    people not offered (e.g. already members)
 */
export default function PeoplePicker({ people, value, onChange, exclude = [], label = "People", placeholder = "Type a name…", focusOnOpen = false }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();
  const inputId = useId();

  useEffect(() => { if (focusOnOpen) inputRef.current?.focus(); }, [focusOnOpen]);

  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const picked = value.map((k) => byKey.get(k)).filter(Boolean);
  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    return people
      .filter((p) => !value.includes(p.key) && !exclude.includes(p.key))
      .filter((p) => !t || (p.name || "").toLowerCase().includes(t) || (p.email || "").toLowerCase().includes(t))
      .slice(0, 8);
  }, [people, value, exclude, q]);

  const add = (p) => { onChange([...value, p.key]); setQ(""); setHi(0); setOpen(false); inputRef.current?.focus(); };
  const remove = (key) => onChange(value.filter((k) => k !== key));

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { if (open && options[hi]) { e.preventDefault(); add(options[hi]); } }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Backspace" && !q && picked.length) remove(picked[picked.length - 1].key);
  };

  return (
    <div className="pp">
      <label className="pp-label" htmlFor={inputId}>{label}</label>
      <div className="pp-box">
        {picked.map((p) => (
          <span key={p.key} className="pp-chip">
            <span className="pp-av" aria-hidden="true">{initials(p.name)}</span>
            {p.name}
            <button type="button" className="pp-chip-x" aria-label={`Remove ${p.name}`} onClick={(e) => { e.stopPropagation(); remove(p.key); }}><X size={12} /></button>
          </span>
        ))}
        <input id={inputId} ref={inputRef} className="pp-input" value={q} autoComplete="off"
          placeholder={picked.length ? "" : placeholder}
          role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && options[hi] ? `${listId}-${hi}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
      </div>
      {open && options.length > 0 && (
        <ul className="pp-list" id={listId} role="listbox">
          {options.map((p, i) => (
            <li key={p.key} id={`${listId}-${i}`} role="option" aria-selected={i === hi}
              className={"pp-opt" + (i === hi ? " pp-opt--hi" : "")}
              onMouseDown={(e) => { e.preventDefault(); add(p); }} onMouseEnter={() => setHi(i)}>
              <span className="pp-av" aria-hidden="true">{initials(p.name)}</span>
              <span className="pp-opt-text"><span className="pp-opt-name">{p.name}</span>{p.email && p.email !== p.name && <span className="pp-opt-mail">{p.email}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q && options.length === 0 && <p className="pp-none">Nobody in this workspace matches “{q}”.</p>}
    </div>
  );
}
