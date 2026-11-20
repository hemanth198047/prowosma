import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, Download, MapPin, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { getProjects } from "../api/projects";
import { getTeamMembers } from "../api/team";
import { unwrapList } from "../api/client";
import {
  addCallTime, addShift, cancelRequest, claimOvertime, decideOvertime, decideRequest, deleteCallTime, deleteShift, exportReport,
  getApprovals, getAttendanceSettings, getBalances, getCallTimes, getFloor, getMyCallTimes, getMyLogs, getMyRequests, getReport,
  requestCorrection, requestLeave, saveAttendanceSettings, saveShift,
} from "../api/attendance";
import { BREAK_LABEL, MODE_LABEL, hm, refreshMyAttendance, timeIn, useAttendanceEnabled, useMyAttendance } from "../hooks/useAttendance";
import "../styles/pages/attendance.css";
import DateInput from "../components/DateInput";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const LEAVE_LABEL = { CASUAL: "Casual", SICK: "Sick", EARNED: "Earned", COMP_OFF: "Comp-off", UNPAID: "Unpaid" };
const STATUS = {
  WORKING: ["Working", "success"], ON_BREAK: ["On a break", "attention"], DONE: ["Done for the day", "info"], NOT_IN: ["Not in yet", "muted"],
  LATE_NOT_IN: ["Late - not in", "danger"], ON_LEAVE: ["On leave", "info"], DAY_OFF: ["Day off", "muted"],
  PRESENT: ["Present", "success"], LATE: ["Late", "attention"], ABSENT: ["No-show", "danger"], LEAVE: ["Leave", "info"],
  HALF_DAY_LEAVE: ["Half-day leave", "info"], HOLIDAY: ["Holiday", "muted"], WEEKEND: ["Weekend", "muted"], NOT_YET_IN: ["Not in yet", "muted"],
  PENDING: ["Waiting for approval", "attention"], APPROVED: ["Approved", "success"], REJECTED: ["Rejected", "danger"], CANCELLED: ["Cancelled", "muted"],
};

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return iso(d); };
const list = unwrapList;

function Pill({ status, label }) {
  const [text, tone] = STATUS[status] || [label || status, "muted"];
  return <span className={`att-badge att-badge--${tone}`}>{label || text}</span>;
}

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="att-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="att-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="att-dialog-head"><h2>{title}</h2><button type="button" className="att-x" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return <label className="att-field"><span>{label}{hint ? <em> {hint}</em> : null}</span>{children}</label>;
}

// ── My time ─────────────────────────────────────────────────────────────

function CorrectionDialog({ initial, onClose, onSaved }) {
  const { show: toast } = useToast();
  const [f, setF] = useState({ date: initial?.date || daysAgo(1), clockIn: initial?.clockIn || "", clockOut: initial?.clockOut || "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await requestCorrection({ ...f, clockIn: f.clockIn || null, clockOut: f.clockOut || null });
      toast("Correction sent for approval.", "success");
      onSaved();
    } catch (e) { setErr(apiErrorMessage(e, "Couldn't send the correction.")); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Fix a missed punch" onClose={onClose}>
      <p className="att-sub">Give the times you actually started and/or finished. Your manager (or HR) approves it, then your day is updated.</p>
      <div className="att-grid2">
        <Field label="Date"><DateInput type="date" value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <span />
        <Field label="Clock-in time" hint="(leave empty if it was right)"><input type="time" value={f.clockIn} onChange={(e) => setF({ ...f, clockIn: e.target.value })} /></Field>
        <Field label="Clock-out time" hint="(leave empty if it was right)"><input type="time" value={f.clockOut} onChange={(e) => setF({ ...f, clockOut: e.target.value })} /></Field>
      </div>
      <Field label="Why was it missed?"><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Phone battery died on set" /></Field>
      {err && <p className="att-error" role="alert">{err}</p>}
      <div className="att-dialog-actions">
        <button type="button" className="btn-secondary pg-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary pg-btn" disabled={busy} onClick={save}>Send for approval</button>
      </div>
    </Dialog>
  );
}

function LeaveDialog({ balances, onClose, onSaved }) {
  const { show: toast } = useToast();
  const [f, setF] = useState({ fromDate: todayIso(), toDate: todayIso(), leaveType: "CASUAL", halfDay: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await requestLeave({ ...f, toDate: f.halfDay ? f.fromDate : f.toDate });
      toast("Leave requested.", "success");
      onSaved();
    } catch (e) { setErr(apiErrorMessage(e, "Couldn't request the leave.")); } finally { setBusy(false); }
  };
  const left = balances?.[f.leaveType]?.left;
  return (
    <Dialog title="Request leave" onClose={onClose}>
      <Field label="Type">
        <select value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>
          {Object.keys(LEAVE_LABEL).map((t) => <option key={t} value={t}>{LEAVE_LABEL[t]}{balances?.[t] ? ` (${balances[t].left} left)` : ""}</option>)}
        </select>
      </Field>
      <div className="att-grid2">
        <Field label="From"><DateInput type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></Field>
        <Field label="To"><DateInput type="date" value={f.halfDay ? f.fromDate : f.toDate} min={f.fromDate} disabled={f.halfDay} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
      </div>
      <label className="att-check"><input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} /> Half a day</label>
      <Field label="Reason" hint="(optional - only your approver sees it)"><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <p className="att-sub">Weekends and holidays inside the dates aren't counted.{left != null ? ` You have ${left} day(s) of ${LEAVE_LABEL[f.leaveType].toLowerCase()} leave left.` : ""}</p>
      {err && <p className="att-error" role="alert">{err}</p>}
      <div className="att-dialog-actions">
        <button type="button" className="btn-secondary pg-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary pg-btn" disabled={busy} onClick={save}>Request</button>
      </div>
    </Dialog>
  );
}

function MyTime({ me }) {
  const { show: toast } = useToast();
  const [range, setRange] = useState({ from: firstOfMonth(), to: todayIso() });
  const [logs, setLogs] = useState(null);
  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState(null);
  const [calls, setCalls] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [err, setErr] = useState("");
  const tz = me?.timezone;

  const load = useCallback(() => Promise.all([getMyLogs(range.from, range.to), getMyRequests(), getBalances(), getMyCallTimes()])
    .then(([l, r, b, c]) => { setLogs(l.data); setRequests(r.data); setBalances(b.data); setCalls(c.data); setErr(""); })
    .catch((e) => setErr(apiErrorMessage(e, "Couldn't load your time logs."))), [range]);
  useEffect(() => { load(); }, [load, me?.state]);

  const claim = async (log) => {
    try { await claimOvertime(log.id, ""); toast("Overtime sent for approval.", "success"); load(); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't claim the overtime."), "error"); }
  };
  const cancel = async (r) => {
    try { await cancelRequest(r.id); toast("Request cancelled.", "success"); load(); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't cancel it."), "error"); }
  };
  const totals = useMemo(() => (logs || []).reduce((a, l) => ({ worked: a.worked + l.workedMinutes, ot: a.ot + l.overtimeMinutes, late: a.late + (l.late ? 1 : 0) }), { worked: 0, ot: 0, late: 0 }), [logs]);
  const upcoming = calls.filter((c) => c.date >= todayIso());

  return (
    <>
      {err && <p className="att-error" role="alert">{err}</p>}
      <div className="pg-summary att-stats">
        <div className="pg-stat"><span className="pg-stat-num">{hm(totals.worked)}</span><span className="pg-stat-label">Worked in this range</span></div>
        <div className="pg-stat"><span className="pg-stat-num">{hm(totals.ot)}</span><span className="pg-stat-label">Overtime</span></div>
        <div className={`pg-stat${totals.late ? " pg-stat--late" : ""}`}><span className="pg-stat-num">{totals.late}</span><span className="pg-stat-label">Late days</span></div>
        {balances && ["CASUAL", "SICK", "EARNED", "COMP_OFF"].map((t) => balances[t] && (
          <div key={t} className="pg-stat"><span className="pg-stat-num">{balances[t].left}</span><span className="pg-stat-label">{LEAVE_LABEL[t]} leave left</span></div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <section className="att-section">
          <h2 className="pg-section-title">Your call times</h2>
          <ul className="att-calls">
            {upcoming.map((c) => <li key={c.id}><MapPin size={14} aria-hidden="true" /> <strong>{c.date} · {timeIn(c.callAt, tz)}</strong> {c.projectName || ""}{c.location ? ` · ${c.location}` : ""} <span className="att-sub">({c.bufferMinutes} min buffer)</span></li>)}
          </ul>
        </section>
      )}

      <section className="att-section">
        <div className="att-row">
          <h2 className="pg-section-title">Time logs</h2>
          <div className="att-range">
            <DateInput type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span>to</span>
            <DateInput type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
        </div>
        {!logs ? <p className="att-sub">Loading…</p> : logs.length === 0 ? <p className="att-sub">No punches in this range.</p> : (
          <div className="att-table-wrap">
            <table className="att-table">
              <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Worked</th><th>Breaks</th><th>Where</th><th>Status</th><th>Overtime</th><th /></tr></thead>
              <tbody>
                {logs.map((l) => {
                  const first = l.sessions?.[0];
                  const lastOut = l.sessions?.length && !l.sessions.some((s) => !s.out) ? l.sessions[l.sessions.length - 1].out : null;
                  return (
                    <tr key={l.id}>
                      <td>{l.date}{l.holidayName ? <div className="att-sub">{l.holidayName}</div> : l.dayType === "WEEKEND" ? <div className="att-sub">Day off</div> : null}</td>
                      <td>{timeIn(first?.in, tz)}</td>
                      <td>{l.state !== "OFF" ? <Pill status={l.state} /> : timeIn(lastOut, tz)}</td>
                      <td>{hm(l.workedMinutes)}</td>
                      <td title={(l.breaks || []).map((b) => BREAK_LABEL[b.type]).join(", ")}>{hm(l.breakMinutes)}</td>
                      <td>{MODE_LABEL[l.workMode] || "—"}{l.projectName ? <div className="att-sub">{l.projectName}</div> : null}</td>
                      <td>
                        {l.late ? <Pill status="LATE" label={`Late ${l.lateMinutes} min`} /> : <Pill status="PRESENT" label="On time" />}
                        {l.autoClosed && <div><Pill status="REJECTED" label="Clock-out missed" /></div>}
                        {l.sessions?.some((s) => s.source === "REGULARIZED") && <div className="att-sub">Corrected</div>}
                      </td>
                      <td>{l.overtimeMinutes > 0 ? <>{hm(l.overtimeMinutes)} {l.overtimeStatus !== "NONE" && <Pill status={l.overtimeStatus} label={l.overtimeStatus === "PENDING" ? "Claimed" : undefined} />}{l.compOffEarned > 0 && <div className="att-sub">+{l.compOffEarned} comp-off</div>}</> : "—"}</td>
                      <td className="att-cell-actions">
                        {l.state === "OFF" && l.overtimeMinutes > 0 && ["NONE", "REJECTED"].includes(l.overtimeStatus) && <button type="button" className="att-link" onClick={() => claim(l)}>Claim overtime</button>}
                        <button type="button" className="att-link" onClick={() => setDialog({ kind: "correction", initial: { date: l.date } })}>{l.autoClosed ? "Fix clock-out" : "Correct"}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="att-section">
        <div className="att-row">
          <h2 className="pg-section-title">My requests</h2>
          <div className="att-row-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog({ kind: "correction" })}><Clock size={14} aria-hidden="true" />Fix a missed punch</button>
            <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog({ kind: "leave" })}><Plus size={14} aria-hidden="true" />Request leave</button>
          </div>
        </div>
        {requests.length === 0 ? <p className="att-sub">No requests yet.</p> : (
          <ul className="att-requests">
            {requests.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.kind === "LEAVE" ? `${LEAVE_LABEL[r.leaveType]} leave · ${r.fromDate}${r.toDate !== r.fromDate ? ` to ${r.toDate}` : ""} (${r.days} day${r.days === 1 ? "" : "s"})`
                    : `Correction · ${r.date}${r.clockIn ? ` in ${r.clockIn}` : ""}${r.clockOut ? ` out ${r.clockOut}` : ""}`}</strong>
                  {r.reason && <div className="att-sub">{r.reason}</div>}
                  {r.reviewNote && <div className="att-sub">Reviewer: {r.reviewNote}</div>}
                </div>
                <Pill status={r.status} />
                {r.status === "PENDING" && <button type="button" className="att-link" onClick={() => cancel(r)}>Cancel</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === "correction" && <CorrectionDialog initial={dialog.initial} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "leave" && <LeaveDialog balances={balances} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
    </>
  );
}

// ── Approvals ───────────────────────────────────────────────────────────

function Approvals({ tz, onChange }) {
  const { show: toast } = useToast();
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});
  const load = useCallback(() => getApprovals().then((r) => setData(r.data)).catch((e) => toast(apiErrorMessage(e, "Couldn't load approvals."), "error")), [toast]);
  useEffect(() => { load(); }, [load]);
  const decide = async (fn, ok) => {
    try { await fn(); toast(ok, "success"); load(); onChange?.(); } catch (e) { toast(apiErrorMessage(e, "That didn't work."), "error"); }
  };
  if (!data) return <p className="att-sub">Loading…</p>;
  const empty = !data.requests.length && !data.overtime.length;
  const NoteBox = ({ id }) => <input className="att-note-input" aria-label="Note (optional)" placeholder="Note (optional)" value={notes[id] || ""} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} />;
  return (
    <>
      {empty && <div className="pg-empty"><h2>Nothing to approve</h2><p>Corrections, leave and overtime from your team appear here.</p></div>}
      {data.requests.length > 0 && (
        <section className="att-section">
          <h2 className="pg-section-title">Leave and corrections <span className="att-count">{data.requests.length}</span></h2>
          <ul className="att-requests">
            {data.requests.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.name || r.email}</strong> — {r.kind === "LEAVE" ? `${LEAVE_LABEL[r.leaveType]} leave, ${r.fromDate}${r.toDate !== r.fromDate ? ` to ${r.toDate}` : ""} (${r.days} day${r.days === 1 ? "" : "s"})`
                    : `missed punch on ${r.date}:${r.clockIn ? ` in ${r.clockIn}` : ""}${r.clockOut ? ` out ${r.clockOut}` : ""}`}
                  {r.reason && <div className="att-sub">“{r.reason}”</div>}
                </div>
                <NoteBox id={r.id} />
                <button type="button" className="btn-primary pg-btn" onClick={() => decide(() => decideRequest(r.id, true, notes[r.id]), "Approved.")}><Check size={14} aria-hidden="true" />Approve</button>
                <button type="button" className="btn-secondary pg-btn" onClick={() => decide(() => decideRequest(r.id, false, notes[r.id]), "Rejected.")}>Reject</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.overtime.length > 0 && (
        <section className="att-section">
          <h2 className="pg-section-title">Overtime claims <span className="att-count">{data.overtime.length}</span></h2>
          <ul className="att-requests">
            {data.overtime.map((l) => (
              <li key={l.id}>
                <div>
                  <strong>{l.name || l.email}</strong> — {hm(l.overtimeMinutes)} overtime on {l.date}{l.holidayName ? ` (${l.holidayName})` : l.dayType === "WEEKEND" ? " (day off)" : ""}
                  <div className="att-sub">Worked {hm(l.workedMinutes)}, from {timeIn(l.sessions?.[0]?.in, tz)}{l.overtimeNote ? ` · “${l.overtimeNote}”` : ""}</div>
                </div>
                <NoteBox id={l.id} />
                <button type="button" className="btn-primary pg-btn" onClick={() => decide(() => decideOvertime(l.id, true, notes[l.id]), "Overtime approved.")}><Check size={14} aria-hidden="true" />Approve</button>
                <button type="button" className="btn-secondary pg-btn" onClick={() => decide(() => decideOvertime(l.id, false, notes[l.id]), "Overtime rejected.")}>Reject</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Who's in (live floor) ───────────────────────────────────────────────

function Floor({ tz }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("ALL");
  const load = useCallback(() => getFloor().then((r) => { setData(r.data); setErr(""); }).catch((e) => setErr(apiErrorMessage(e, "Couldn't load who's in."))), []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (err) return <p className="att-error">{err}</p>;
  if (!data) return <p className="att-sub">Loading…</p>;
  const c = data.counts;
  const chips = [["ALL", "Everyone", data.people.length], ["WORKING", "Working", c.WORKING], ["ON_BREAK", "On a break", c.ON_BREAK], ["LATE_NOT_IN", "Late - not in", c.LATE_NOT_IN],
    ["NOT_IN", "Not in yet", c.NOT_IN], ["DONE", "Done", c.DONE], ["ON_LEAVE", "On leave", c.ON_LEAVE], ["DAY_OFF", "Day off", c.DAY_OFF]];
  const rows = filter === "ALL" ? data.people : data.people.filter((p) => p.status === filter);
  return (
    <>
      <div className="att-row">
        <div className="pg-seg att-chips" role="group" aria-label="Show">
          {chips.map(([k, label, n]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} <span className="att-count">{n}</span></button>)}
        </div>
        <button type="button" className="btn-secondary pg-btn" onClick={load}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
      </div>
      <p className="att-sub">{data.holiday ? `Today is a holiday: ${data.holiday}. ` : ""}{c.LATE} late today · updates every 30 seconds · as of {timeIn(data.asOf, tz)}</p>
      <div className="att-table-wrap">
        <table className="att-table">
          <thead><tr><th>Person</th><th>Status</th><th>Since</th><th>First in</th><th>Worked</th><th>Where</th><th>Location / IP</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.email}>
                <td><strong>{p.name}</strong><div className="att-sub">{p.title || p.email}{p.department ? ` · ${p.department}` : ""}</div></td>
                <td><Pill status={p.status} label={p.status === "ON_BREAK" && p.breakType ? BREAK_LABEL[p.breakType] : p.status === "ON_LEAVE" && p.leaveType ? `${LEAVE_LABEL[p.leaveType]} leave` : undefined} />
                  {p.late && <div><Pill status="LATE" label={`Late ${p.lateMinutes} min`} /></div>}</td>
                <td>{p.since ? timeIn(p.since, tz) : "—"}</td>
                <td>{timeIn(p.firstIn, tz)}</td>
                <td>{p.workedMinutes != null ? hm(p.workedMinutes) : "—"}</td>
                <td>{MODE_LABEL[p.workMode] || "—"}{p.projectName ? <div className="att-sub">{p.projectName}</div> : null}</td>
                <td>{p.geo ? <a href={`https://www.openstreetmap.org/?mlat=${p.geo.lat}&mlon=${p.geo.lng}#map=17/${p.geo.lat}/${p.geo.lng}`} target="_blank" rel="noreferrer noopener"><MapPin size={12} aria-hidden="true" /> Map</a> : null}
                  {p.ip ? <div className="att-sub">{p.ip}</div> : null}{!p.geo && !p.ip ? "—" : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Reports and export ──────────────────────────────────────────────────

function Reports({ canExport, tz }) {
  const { show: toast } = useToast();
  const [range, setRange] = useState({ from: firstOfMonth(), to: todayIso(), email: "" });
  const [rows, setRows] = useState(null);
  const [people, setPeople] = useState([]);
  useEffect(() => { getTeamMembers().then((r) => setPeople(list(r))).catch(() => {}); }, []);
  const load = useCallback(() => {
    getReport({ from: range.from, to: range.to, email: range.email || undefined }).then((r) => setRows(r.data))
      .catch((e) => { setRows([]); toast(apiErrorMessage(e, "Couldn't load the report."), "error"); });
  }, [range, toast]);
  useEffect(() => { load(); }, [load]);
  const download = async (format) => {
    try {
      const r = await exportReport({ from: range.from, to: range.to, email: range.email || undefined, format });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `attendance-${range.from}-to-${range.to}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(apiErrorMessage(e, "Couldn't export."), "error"); }
  };
  const summary = useMemo(() => {
    const s = {};
    for (const r of rows || []) s[r.status] = (s[r.status] || 0) + 1;
    return s;
  }, [rows]);
  return (
    <>
      <div className="att-row">
        <div className="att-range">
          <DateInput type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span>to</span>
          <DateInput type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <select aria-label="Person" value={range.email} onChange={(e) => setRange({ ...range, email: e.target.value })}>
            <option value="">Everyone I can see</option>
            {people.filter((p) => p.email).map((p) => <option key={p.id} value={p.email.toLowerCase()}>{p.name || p.email}</option>)}
          </select>
        </div>
        {canExport && (
          <div className="att-row-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={() => download("csv")}><Download size={14} aria-hidden="true" />CSV</button>
            <button type="button" className="btn-secondary pg-btn" onClick={() => download("xlsx")}><Download size={14} aria-hidden="true" />Excel</button>
          </div>
        )}
      </div>
      <p className="att-sub">{["PRESENT", "LATE", "ABSENT", "LEAVE", "HALF_DAY_LEAVE"].filter((k) => summary[k]).map((k) => `${summary[k]} ${STATUS[k][0].toLowerCase()}`).join(" · ") || "Nothing in this range."}
        {" "}A no-show is a past working day with no punch and no approved leave.</p>
      {!rows ? <p className="att-sub">Loading…</p> : rows.length > 0 && (
        <div className="att-table-wrap">
          <table className="att-table">
            <thead><tr><th>Date</th><th>Person</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Late</th><th>Overtime</th><th>Where</th></tr></thead>
            <tbody>
              {rows.slice(0, 1000).map((r) => (
                <tr key={`${r.email}|${r.date}`}>
                  <td>{r.date}</td>
                  <td>{r.name}</td>
                  <td><Pill status={r.status} label={r.status === "LEAVE" && r.leaveType ? `${LEAVE_LABEL[r.leaveType]} leave` : r.status === "HOLIDAY" && r.holiday ? r.holiday : undefined} />{r.autoClosed && <div className="att-sub">Clock-out missed</div>}</td>
                  <td>{timeIn(r.firstIn, tz)}</td>
                  <td>{r.state && r.state !== "OFF" ? "Still in" : timeIn(r.lastOut, tz)}</td>
                  <td>{r.workedMinutes != null ? hm(r.workedMinutes) : "—"}</td>
                  <td>{r.lateMinutes ? `${r.lateMinutes} min` : "—"}</td>
                  <td>{r.overtimeMinutes ? `${hm(r.overtimeMinutes)}${r.overtimeStatus && r.overtimeStatus !== "NONE" ? ` (${STATUS[r.overtimeStatus][0].toLowerCase()})` : ""}` : "—"}</td>
                  <td>{MODE_LABEL[r.workMode] || "—"}{r.project ? <div className="att-sub">{r.project}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 1000 && <p className="att-sub">Showing the first 1,000 rows. Export to see them all.</p>}
        </div>
      )}
    </>
  );
}

// ── Call times ──────────────────────────────────────────────────────────

function CallTimes({ tz }) {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [f, setF] = useState({ projectId: "", date: todayIso(), callTime: "07:00", bufferMinutes: 15, location: "", note: "", crew: [] });
  const [err, setErr] = useState("");
  const load = useCallback(() => getCallTimes().then((r) => setItems(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    getProjects().then((r) => setProjects(list(r))).catch(() => {});
    getTeamMembers().then((r) => setPeople(list(r).filter((p) => p.email))).catch(() => {});
  }, [load]);
  const add = async () => {
    setErr("");
    try {
      await addCallTime({ ...f, bufferMinutes: Number(f.bufferMinutes) });
      toast("Call time added. The crew sees it when they clock in.", "success");
      setF({ ...f, crew: [], note: "" });
      load();
    } catch (e) { setErr(apiErrorMessage(e, "Couldn't add the call time.")); }
  };
  const remove = async (c) => {
    if (!(await confirm({ title: "Remove this call time?", message: `${c.date} ${c.callTime}${c.projectName ? ` · ${c.projectName}` : ""}. The crew's shift start applies again.`, confirmText: "Remove", danger: true }))) return;
    try { await deleteCallTime(c.id); load(); } catch (e) { toast(apiErrorMessage(e, "Couldn't remove it."), "error"); }
  };
  const toggle = (email) => setF({ ...f, crew: f.crew.includes(email) ? f.crew.filter((e) => e !== email) : [...f.crew, email] });
  return (
    <>
      <p className="att-sub">For shoots and on-set days: the crew's start time that day is the call time, and clocking in after call time + buffer counts as late.</p>
      <div className="att-card">
        <div className="att-grid3">
          <Field label="Project"><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Date"><DateInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Call time"><input type="time" value={f.callTime} onChange={(e) => setF({ ...f, callTime: e.target.value })} /></Field>
          <Field label="Buffer" hint="(minutes)"><input type="number" min={0} max={240} value={f.bufferMinutes} onChange={(e) => setF({ ...f, bufferMinutes: e.target.value })} /></Field>
          <Field label="Location" hint="(optional)"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Film City, Stage 4" /></Field>
          <Field label="Note" hint="(optional)"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <fieldset className="att-crew"><legend>Crew <em>({f.crew.length} chosen)</em></legend>
          {people.map((p) => <label key={p.id} className="att-check"><input type="checkbox" checked={f.crew.includes(p.email.toLowerCase())} onChange={() => toggle(p.email.toLowerCase())} /> {p.name || p.email}</label>)}
        </fieldset>
        {err && <p className="att-error" role="alert">{err}</p>}
        <button type="button" className="btn-primary pg-btn" onClick={add}><Plus size={14} aria-hidden="true" />Add call time</button>
      </div>
      <ul className="att-requests">
        {items.length === 0 && <li><span className="att-sub">No call times in the next 60 days.</span></li>}
        {items.map((c) => (
          <li key={c.id}>
            <div><strong>{c.date} · {timeIn(c.callAt, tz)}</strong> {c.projectName || ""}{c.location ? ` · ${c.location}` : ""} <span className="att-sub">({c.bufferMinutes} min buffer, {c.crew.length} crew)</span>{c.note && <div className="att-sub">{c.note}</div>}</div>
            <button type="button" className="att-link att-danger" onClick={() => remove(c)}><Trash2 size={13} aria-hidden="true" /> Remove</button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Rules and shifts ────────────────────────────────────────────────────

function ShiftDialog({ shift, people, onClose, onSaved }) {
  const [f, setF] = useState(shift || { name: "", start: "10:00", end: "19:00", days: ["MON", "TUE", "WED", "THU", "FRI", "SAT"], graceMinutes: 15, defaultShift: false, members: [] });
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    try {
      const body = { ...f, graceMinutes: Number(f.graceMinutes) };
      if (shift?.id) await saveShift(shift.id, body); else await addShift(body);
      onSaved();
    } catch (e) { setErr(apiErrorMessage(e, "Couldn't save the shift.")); }
  };
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  return (
    <Dialog title={shift?.id ? "Edit shift" : "Add a shift"} onClose={onClose}>
      <div className="att-grid3">
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Studio day" /></Field>
        <Field label="Starts"><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Ends"><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <fieldset className="att-days"><legend>Working days</legend>
        {DAYS.map((d) => <label key={d} className="att-check"><input type="checkbox" checked={f.days.includes(d)} onChange={() => toggle("days", d)} /> {d.charAt(0) + d.slice(1).toLowerCase()}</label>)}
      </fieldset>
      <Field label="Grace period" hint="(minutes before someone counts as late)"><input type="number" min={0} max={240} value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: e.target.value })} /></Field>
      <label className="att-check"><input type="checkbox" checked={f.defaultShift} onChange={(e) => setF({ ...f, defaultShift: e.target.checked })} /> Default shift for everyone not named on another shift</label>
      <fieldset className="att-crew"><legend>People on this shift <em>({f.members.length})</em></legend>
        {people.map((p) => <label key={p.id} className="att-check"><input type="checkbox" checked={f.members.includes(p.email.toLowerCase())} onChange={() => toggle("members", p.email.toLowerCase())} /> {p.name || p.email}</label>)}
      </fieldset>
      <p className="att-sub">A person is on one shift; adding them here takes them off any other.</p>
      {err && <p className="att-error" role="alert">{err}</p>}
      <div className="att-dialog-actions">
        <button type="button" className="btn-secondary pg-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary pg-btn" onClick={save}>Save shift</button>
      </div>
    </Dialog>
  );
}

function Rules() {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [s, setS] = useState(null);
  const [people, setPeople] = useState([]);
  const [shiftDialog, setShiftDialog] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => getAttendanceSettings().then((r) => { setData(r.data); setS({ ...r.data.settings, hrText: (r.data.settings.hrEmails || []).join(", ") }); }), []);
  useEffect(() => { load(); getTeamMembers().then((r) => setPeople(list(r).filter((p) => p.email))).catch(() => {}); }, [load]);
  if (!data || !s) return <p className="att-sub">Loading…</p>;
  const save = async () => {
    setErr("");
    try {
      const body = { ...s, hrEmails: s.hrText.split(/[\s,;]+/).filter(Boolean) };
      delete body.hrText;
      ["idleMinutes", "endOfDayReminderMinutes", "autoClockOutHours", "overtimeAfterMinutes"].forEach((k) => { body[k] = Number(body[k]); });
      Object.keys(body.leaveQuota || {}).forEach((k) => { body.leaveQuota[k] = Number(body.leaveQuota[k]); });
      await saveAttendanceSettings(body);
      toast("Rules saved.", "success");
      load(); refreshMyAttendance().catch(() => {});
    } catch (e) { setErr(apiErrorMessage(e, "Couldn't save the rules.")); }
  };
  const remove = async (sh) => {
    if (!(await confirm({ title: `Delete the shift "${sh.name}"?`, message: "People on it move to the default shift.", confirmText: "Delete", danger: true }))) return;
    try { await deleteShift(sh.id); load(); } catch (e) { toast(apiErrorMessage(e, "Couldn't delete it."), "error"); }
  };
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <>
      <section className="att-section">
        <div className="att-row">
          <h2 className="pg-section-title">Shifts</h2>
          <button type="button" className="btn-secondary pg-btn" onClick={() => setShiftDialog({})}><Plus size={14} aria-hidden="true" />Add shift</button>
        </div>
        {data.shifts.length === 0 && <p className="att-sub">No shifts yet. Everyone uses 10:00–19:00 on the workspace's working days with 15 minutes' grace until you add one.</p>}
        <ul className="att-requests">
          {data.shifts.map((sh) => (
            <li key={sh.id}>
              <div><strong>{sh.name}</strong>{sh.defaultShift && <span className="att-tag">Default</span>} {sh.start}–{sh.end} · {sh.days.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(", ")} · {sh.graceMinutes} min grace
                <div className="att-sub">{sh.members.length} {sh.members.length === 1 ? "person" : "people"}{sh.defaultShift ? " + everyone not on another shift" : ""}</div></div>
              <button type="button" className="att-link" onClick={() => setShiftDialog(sh)}>Edit</button>
              <button type="button" className="att-link att-danger" onClick={() => remove(sh)}>Delete</button>
            </li>
          ))}
        </ul>
        <p className="att-sub">Holidays come from <Link to="/settings">Workspace settings → Holidays</Link>. Nobody is marked a no-show on a holiday or approved leave.</p>
      </section>

      <section className="att-section att-card">
        <h2 className="pg-section-title">Rules</h2>
        <div className="att-grid2">
          <Field label="Time zone" hint={`(empty = workspace's: ${data.effectiveTimezone})`}><input value={s.timezone || ""} onChange={set("timezone")} placeholder="e.g. Asia/Kolkata" /></Field>
          <Field label="Location at punch">
            <select value={s.locationMode} onChange={set("locationMode")}>
              <option value="OFF">Don't ask</option>
              <option value="OPTIONAL">Ask; optional</option>
              <option value="REQUIRED_ON_LOCATION">Required for on-location work</option>
            </select>
          </Field>
          <Field label="Inactivity after" hint="(minutes; 0 = off)"><input type="number" min={0} max={240} value={s.idleMinutes} onChange={set("idleMinutes")} /></Field>
          <Field label="When inactive">
            <select value={s.idleAction} onChange={set("idleAction")}>
              <option value="REMIND">Ask "still working?"</option>
              <option value="PAUSE">Pause the clock (ask when they're back)</option>
            </select>
          </Field>
          <Field label="End-of-day reminder" hint="(minutes after the shift; 0 = off)"><input type="number" min={0} max={600} value={s.endOfDayReminderMinutes} onChange={set("endOfDayReminderMinutes")} /></Field>
          <Field label="Close a forgotten clock-out after" hint="(hours)"><input type="number" min={4} max={24} value={s.autoClockOutHours} onChange={set("autoClockOutHours")} /></Field>
          <Field label="Overtime after" hint="(worked minutes a day; 540 = 9 hours)"><input type="number" min={60} max={1440} value={s.overtimeAfterMinutes} onChange={set("overtimeAfterMinutes")} /></Field>
          <Field label="HR" hint="(emails; they can approve, see everyone, change rules and export)"><input value={s.hrText} onChange={set("hrText")} placeholder="hr@company.com" /></Field>
        </div>
        <label className="att-check"><input type="checkbox" checked={s.askWorkMode} onChange={set("askWorkMode")} /> Ask where people work (office / remote / on location) when they clock in</label>
        <label className="att-check"><input type="checkbox" checked={s.weekendHolidayOvertime} onChange={set("weekendHolidayOvertime")} /> All work on days off and holidays is overtime</label>
        <label className="att-check"><input type="checkbox" checked={s.compOffEnabled} onChange={set("compOffEnabled")} /> Approved day-off overtime earns comp-off (a full day for 6+ hours, half for 3+)</label>
        <h3 className="att-h3">Leave per year</h3>
        <div className="att-grid3">
          {["CASUAL", "SICK", "EARNED"].map((t) => (
            <Field key={t} label={`${LEAVE_LABEL[t]} leave`} hint="(days)"><input type="number" min={0} max={365} step={0.5} value={s.leaveQuota?.[t] ?? 0} onChange={(e) => setS({ ...s, leaveQuota: { ...s.leaveQuota, [t]: e.target.value } })} /></Field>
          ))}
        </div>
        {err && <p className="att-error" role="alert">{err}</p>}
        <button type="button" className="btn-primary pg-btn" onClick={save}>Save rules</button>
      </section>
      {shiftDialog && <ShiftDialog shift={shiftDialog.id ? shiftDialog : null} people={people} onClose={() => setShiftDialog(null)} onSaved={() => { setShiftDialog(null); load(); refreshMyAttendance().catch(() => {}); }} />}
    </>
  );
}

// ── page ────────────────────────────────────────────────────────────────

export default function Attendance() {
  const enabled = useAttendanceEnabled();
  const me = useMyAttendance(enabled);
  const [tab, setTab] = useState("me");

  if (!enabled) {
    return <div className="pg-empty"><h2>Attendance isn't turned on</h2><p>An admin can turn it on under Admin Centre → Feature flags → Attendance.</p></div>;
  }
  if (!me) return <p className="att-sub">Loading…</p>;
  const admin = me.canManage, manager = me.isManager;
  const tabs = [["me", "My time"], ...(admin || manager ? [["approvals", "Approvals"]] : []), ...(admin ? [["floor", "Who's in"]] : []),
    ...(admin || manager ? [["reports", "Reports"]] : []), ...(admin ? [["calls", "Call times"], ["rules", "Rules & shifts"]] : [])];
  return (
    <div className="att-page">
      <header className="pg-title-row">
        <div className="pg-title-text">
          <h1>Attendance</h1>
          <p>Clock in and out from the top bar. Your time logs, leave and corrections are here.</p>
        </div>
      </header>
      <div className="att-tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className="att-tab" onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "me" && <MyTime me={me} />}
      {tab === "approvals" && <Approvals tz={me.timezone} onChange={() => refreshMyAttendance().catch(() => {})} />}
      {tab === "floor" && <Floor tz={me.timezone} />}
      {tab === "reports" && <Reports canExport={admin} tz={me.timezone} />}
      {tab === "calls" && <CallTimes tz={me.timezone} />}
      {tab === "rules" && <Rules />}
    </div>
  );
}
