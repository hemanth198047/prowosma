import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, History, Search, X } from "lucide-react";
import { KINDS, KIND, describe, normalise } from "../utils/taskHistory";
import client from "../api/client";
import { apiErrorMessage } from "../utils/apiError";
import { parseServerDateTime } from "../utils/serverTime";
import "../styles/task-history.css";
import DateInput from "./DateInput";

const WHEN = [
  ["any", "Any time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["custom", "Custom dates"],
];

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function dayLabel(d) {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
const startOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function csvCell(v) {
  let s = String(v ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * A task's history in its own window, with filters: person, type of change, time period, search; newest or oldest first.
 * Opened from the task panel ("History") or a task's ⋯ menu. Filtering is instant (one task's history is small).
 */
export default function TaskHistory({ task, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [person, setPerson] = useState("");
  const [kinds, setKinds] = useState([]);
  const [when, setWhen] = useState("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [oldest, setOldest] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    client.get(`/activity-logs/task/${task.id}`, { headers: { "Cache-Control": "no-cache" } })
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(apiErrorMessage(e, "Couldn't load the history.")); });
    return () => { alive = false; };
  }, [task.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const entries = useMemo(() => (data?.entries || []).map(normalise).map((e) => ({ ...e, date: parseServerDateTime(e.at) })), [data]);
  const people = useMemo(() => {
    const m = new Map();
    entries.forEach((e) => { const p = m.get(e.by) || { by: e.by, name: e.byName || e.by, n: 0 }; p.n++; m.set(e.by, p); });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [entries]);
  const kindCounts = useMemo(() => {
    const c = {}; entries.forEach((e) => { c[e.kind] = (c[e.kind] || 0) + 1; }); return c;
  }, [entries]);

  const shown = useMemo(() => {
    const now = new Date();
    let lo = null, hi = null;
    if (when === "today") lo = startOf(now);
    else if (when === "7" || when === "30") { lo = startOf(now); lo.setDate(lo.getDate() - (Number(when) - 1)); }
    else if (when === "custom") {
      if (from) lo = startOf(new Date(`${from}T00:00:00`));
      if (to) { hi = startOf(new Date(`${to}T00:00:00`)); hi.setDate(hi.getDate() + 1); }
    }
    const term = q.trim().toLowerCase();
    const list = entries.filter((e) =>
      (!person || e.by === person)
      && (!kinds.length || kinds.includes(e.kind))
      && (!lo || (e.date && e.date >= lo))
      && (!hi || (e.date && e.date < hi))
      && (!term || `${e.byName} ${describe(e).join(" ")}`.toLowerCase().includes(term)));
    return oldest ? [...list].reverse() : list;
  }, [entries, person, kinds, when, from, to, q, oldest]);

  const groups = useMemo(() => {
    const out = [];
    shown.forEach((e) => {
      const label = e.date ? dayLabel(e.date) : "Unknown date";
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e); else out.push({ label, items: [e] });
    });
    return out;
  }, [shown]);

  const filtered = person || kinds.length || when !== "any" || q.trim();
  const clear = () => { setPerson(""); setKinds([]); setWhen("any"); setFrom(""); setTo(""); setQ(""); };
  const toggleKind = (k) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));

  const exportCsv = () => {
    const rows = [["When", "Who", "Type", "What happened", "Detail"]].concat(shown.map((e) => {
      const [what, quote] = describe(e);
      return [e.date ? e.date.toLocaleString() : "", e.byName, KIND[e.kind]?.label || "", what, quote || ""];
    }));
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(task.title || "task").replace(/[^\w-]+/g, "-").slice(0, 60)}-history.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return createPortal(
    <div className="th-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="th" role="dialog" aria-modal="true" aria-labelledby="th-title">
        <header className="th-head">
          <div className="th-titles">
            <h2 id="th-title"><History size={18} aria-hidden="true" /> History</h2>
            <p title={task.title}>{task.title}</p>
          </div>
          <button type="button" className="th-icon" onClick={exportCsv} disabled={!shown.length} aria-label="Export what's shown as CSV" title="Export CSV"><Download size={17} /></button>
          <button type="button" className="th-icon" ref={closeRef} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="th-filters">
          <label className="th-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the history" aria-label="Search the history" />
          </label>
          <div className="th-row">
            <label className="th-field">
              <span>Person</span>
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Everyone</option>
                {people.map((p) => <option key={p.by} value={p.by}>{p.name} ({p.n})</option>)}
              </select>
            </label>
            <label className="th-field">
              <span>When</span>
              <select value={when} onChange={(e) => setWhen(e.target.value)}>
                {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {when === "custom" && (
              <>
                <label className="th-field"><span>From</span><DateInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="th-field"><span>To</span><DateInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              </>
            )}
            <label className="th-field">
              <span>Order</span>
              <select value={oldest ? "old" : "new"} onChange={(e) => setOldest(e.target.value === "old")}>
                <option value="new">Newest first</option>
                <option value="old">Oldest first</option>
              </select>
            </label>
          </div>
          <div className="th-kinds" role="group" aria-label="Type of change">
            {KINDS.filter((k) => kindCounts[k.key]).map((k) => (
              <button key={k.key} type="button" className={"th-kind" + (kinds.includes(k.key) ? " on" : "")}
                aria-pressed={kinds.includes(k.key)} onClick={() => toggleKind(k.key)}>
                <k.icon size={13} aria-hidden="true" /> {k.label} <span className="th-n">{kindCounts[k.key]}</span>
              </button>
            ))}
          </div>
          <div className="th-summary" aria-live="polite">
            {data && <span>{filtered ? `Showing ${shown.length} of ${entries.length}` : `${entries.length} ${entries.length === 1 ? "change" : "changes"}`}</span>}
            {filtered && <button type="button" className="th-clear" onClick={clear}>Clear filters</button>}
          </div>
        </div>

        <div className="th-body">
          {error && <p className="th-error" role="alert">{error}</p>}
          {!data && !error && <p className="th-muted">Loading…</p>}
          {data && entries.length === 0 && <p className="th-muted">Nothing has changed on this task yet.</p>}
          {data && entries.length > 0 && shown.length === 0 && <p className="th-muted">Nothing matches these filters. <button type="button" className="th-clear" onClick={clear}>Clear filters</button></p>}
          {groups.map((g) => (
            <section key={g.label + g.items[0].id} className="th-day" aria-label={g.label}>
              <h3>{g.label}</h3>
              <ol className="th-list">
                {g.items.map((e) => {
                  const K = KIND[e.kind] || KIND.OTHER;
                  const [what, quote] = describe(e);
                  return (
                    <li key={e.id} className={"th-item th-k-" + e.kind.toLowerCase()}>
                      <span className="th-dot" aria-hidden="true"><K.icon size={14} /></span>
                      <div className="th-text">
                        <p><strong>{e.byName}</strong> {what}</p>
                        {quote && <blockquote>{quote}</blockquote>}
                      </div>
                      <time dateTime={e.date?.toISOString()} title={e.date?.toLocaleString()}>
                        {e.date ? e.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
