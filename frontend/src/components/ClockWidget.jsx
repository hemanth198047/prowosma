import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Coffee, LogIn, LogOut, MapPin, Play, Utensils, X } from "lucide-react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { getProjects } from "../api/projects";
import { unwrapList } from "../api/client";
import { clockIn, clockOut, endBreak, reportIdle, startBreak } from "../api/attendance";
import {
  BREAK_LABEL, MODE_LABEL, currentPosition, hms, publishMyAttendance, timeIn, useAttendanceEnabled, useMyAttendance, workedMs,
} from "../hooks/useAttendance";
import "../styles/pages/attendance.css";

const ACTIVITY = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];

/**
 * The Clock In / Out button in the top bar, next to the clock. Shows the shift timer while working, the break timer on a
 * break, and opens a small panel to clock in (where you're working, which project), take a break or clock out.
 * Also watches for inactivity (if the workspace turned it on) and reminds people still clocked in after their shift.
 * Renders nothing unless the workspace's "attendance" feature flag is on.
 */
export default function ClockWidget({ mobile = false }) {
  const enabled = useAttendanceEnabled();
  const phone = usePhoneLayout();
  // The app shows either the top bar (desktop) or the phone header, never both; only the visible copy runs,
  // so the minute refresh and idle detection never run twice.
  if (!enabled || phone !== mobile) return null;
  return <Clock />;
}

const PHONE = "(max-width: 768px)";
function usePhoneLayout() {
  const [query] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE) : null));
  const [phone, setPhone] = useState(() => !!query?.matches);
  useEffect(() => {
    if (!query) return undefined;
    const on = (e) => setPhone(e.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, [query]);
  return phone;
}

function Clock() {
  const data = useMyAttendance(true);
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [idlePrompt, setIdlePrompt] = useState(null);   // { kind: "remind" } | { kind: "paused", since }
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const act = useCallback(async (fn, done) => {
    setBusy(true);
    try {
      const r = await fn();
      publishMyAttendance(r.data);
      if (done) toast(done, "success");
      return r.data;
    } catch (e) {
      toast(apiErrorMessage(e, "That didn't work. Please try again."), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useIdleWatch(data, act, setIdlePrompt);
  const reminder = useEndOfDayReminder(data, now);

  if (!data) return null;
  const { state, log, today, rules, timezone } = data;
  const tz = timezone;
  const openBreak = (log?.breaks || []).find((b) => !b.end);
  const worked = workedMs(log, now);

  let pill;
  if (state === "WORKING") {
    pill = <><span className="att-dot att-dot--on" aria-hidden="true" /><span className="att-pill-time">{hms(worked)}</span></>;
  } else if (state === "ON_BREAK") {
    pill = <><Coffee size={13} aria-hidden="true" /><span className="att-pill-time">{hms(now - Date.parse(openBreak?.start || now))}</span></>;
  } else {
    pill = <><LogIn size={13} aria-hidden="true" /><span>Clock in</span></>;
  }
  const lateNotIn = state === "OFF" && !log?.sessions?.length && today?.dayType === "WORKDAY" && !today?.onLeave && today?.expectedStart
    && now > Date.parse(today.expectedStart) + (today.graceMinutes || 0) * 60000;
  const label = state === "WORKING" ? `Clocked in, ${hms(worked)} worked today. Open the clock.`
    : state === "ON_BREAK" ? `On a ${BREAK_LABEL[openBreak?.type] || "break"}. Open the clock.` : "Clock in";

  return (
    <div className="att-widget" ref={wrapRef}>
      <button ref={btnRef} type="button" aria-expanded={open} aria-haspopup="dialog" aria-label={label} title={label}
        className={`att-pill att-pill--${state.toLowerCase()}${lateNotIn ? " att-pill--late" : ""}${reminder ? " att-pill--remind" : ""}`}
        onClick={() => setOpen((o) => !o)}>
        {pill}
      </button>
      {open && (
        <div className="att-pop" role="dialog" aria-label="Attendance">
          <div className="att-pop-head">
            <strong>{state === "OFF" ? (log?.sessions?.length ? "You're clocked out" : "Start your day") : state === "WORKING" ? "You're clocked in" : "On a break"}</strong>
            <button type="button" className="att-x" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          {state === "OFF"
            ? <ClockInForm data={data} busy={busy} onDone={() => setOpen(false)} act={act} />
            : (
              <>
                <Today data={data} now={now} />
                {reminder && <p className="att-note att-note--warn">Your shift ended at {timeIn(today?.expectedEnd, tz)}. Clock out when you finish.</p>}
                <div className="att-pop-actions">
                  {state === "WORKING" ? (
                    <>
                      <button type="button" className="btn-secondary pg-btn" disabled={busy} onClick={() => act(() => startBreak("LUNCH"), "Lunch break started.")}><Utensils size={14} aria-hidden="true" />Lunch</button>
                      <button type="button" className="btn-secondary pg-btn" disabled={busy} onClick={() => act(() => startBreak("TEA"), "Tea / coffee break started.")}><Coffee size={14} aria-hidden="true" />Tea / coffee</button>
                    </>
                  ) : (
                    <button type="button" className="btn-primary pg-btn" disabled={busy} onClick={() => act(() => endBreak(false), "Welcome back.")}><Play size={14} aria-hidden="true" />End break</button>
                  )}
                  <button type="button" className="btn-secondary pg-btn att-out" disabled={busy}
                    onClick={async () => {
                      const pos = rules?.locationMode === "OFF" ? null : await currentPosition();
                      const r = await act(() => clockOut(pos || {}), "Clocked out. See you tomorrow.");
                      if (r) setOpen(false);
                    }}><LogOut size={14} aria-hidden="true" />Clock out</button>
                </div>
              </>
            )}
          <Link to="/attendance" className="att-more" onClick={() => setOpen(false)}>My time logs, leave and corrections</Link>
        </div>
      )}
      {idlePrompt && <IdlePrompt prompt={idlePrompt} tz={tz} busy={busy} act={act} onClose={() => setIdlePrompt(null)} />}
    </div>
  );
}

function Today({ data, now }) {
  const { log, today, timezone: tz } = data;
  const first = (log?.sessions || [])[0];
  return (
    <dl className="att-today">
      <div><dt>Worked today</dt><dd>{hms(workedMs(log, now))}</dd></div>
      <div><dt>First in</dt><dd>{timeIn(first?.in, tz)}{log?.late ? <span className="att-tag att-tag--late">Late {log.lateMinutes} min</span> : null}</dd></div>
      {log?.workMode && <div><dt>Working</dt><dd>{MODE_LABEL[log.workMode]}{log.projectName ? ` · ${log.projectName}` : ""}</dd></div>}
      {today?.expectedEnd && <div><dt>Shift ends</dt><dd>{timeIn(today.expectedEnd, tz)}</dd></div>}
    </dl>
  );
}

function ClockInForm({ data, busy, act, onDone }) {
  const { rules, today, timezone: tz } = data;
  const [mode, setMode] = useState(data.log?.workMode || "");
  const [projectId, setProjectId] = useState(data.log?.projectId || today?.callTime?.projectId || "");
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getProjects().then((r) => {
      setProjects(unwrapList(r).filter((p) => !["DONE", "ARCHIVED", "CANCELLED"].includes(String(p.status || "").toUpperCase())));
    }).catch(() => setProjects([]));
  }, []);

  const go = async () => {
    setErr("");
    if (rules?.askWorkMode && !mode) { setErr("Choose where you're working today."); return; }
    const needLocation = rules?.locationMode === "REQUIRED_ON_LOCATION" && mode === "ON_LOCATION";
    const pos = rules?.locationMode === "OFF" ? null : await currentPosition();
    if (needLocation && !pos) { setErr("Allow location in your browser so your on-location clock-in can be recorded, then try again."); return; }
    const r = await act(() => clockIn({ workMode: mode || null, projectId: projectId || null, ...(pos || {}) }), "Clocked in. Have a good day.");
    if (r) onDone();
  };

  return (
    <div className="att-form">
      {today?.holidayName && <p className="att-note">Today is a holiday ({today.holidayName}). Time you clock counts as overtime.</p>}
      {today?.dayType === "WEEKEND" && !today?.holidayName && <p className="att-note">Today isn't one of your shift days. Time you clock counts as overtime.</p>}
      {today?.onLeave && <p className="att-note att-note--warn">You're on approved leave today.</p>}
      {today?.callTime && <p className="att-note"><MapPin size={13} aria-hidden="true" /> Call time {timeIn(today.callTime.callAt, tz)}{today.callTime.projectName ? ` · ${today.callTime.projectName}` : ""}{today.callTime.location ? ` · ${today.callTime.location}` : ""}</p>}
      {!today?.callTime && today?.dayType === "WORKDAY" && <p className="att-sub">Your shift: {data.shift?.start}–{data.shift?.end} ({data.shift?.graceMinutes} min grace)</p>}
      <fieldset className="att-modes">
        <legend>Where are you working?</legend>
        {(rules?.workModes || Object.keys(MODE_LABEL)).map((m) => (
          <label key={m} className={`att-mode${mode === m ? " att-mode--on" : ""}`}>
            <input type="radio" name="att-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
            {MODE_LABEL[m]}
          </label>
        ))}
      </fieldset>
      <label className="att-field">
        <span>Project <em>(optional)</em></span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {rules?.locationMode !== "OFF" && <p className="att-sub"><MapPin size={12} aria-hidden="true" /> Your location is read once when you clock in or out{rules?.locationMode === "REQUIRED_ON_LOCATION" ? " (needed for on-location work)" : " if you allow it"}. It is never tracked.</p>}
      {err && <p className="att-error" role="alert">{err}</p>}
      <button type="button" className="btn-primary pg-btn att-in" disabled={busy} onClick={go}><LogIn size={15} aria-hidden="true" />Clock in</button>
    </div>
  );
}

/**
 * Inactivity: after the workspace's idle minutes with no mouse or keyboard activity in Prowosma, either ask "still working?"
 * (remind) or start an automatic break back-dated to the last activity (pause), and ask when the person comes back.
 */
function useIdleWatch(data, act, setPrompt) {
  const last = useRef(0);
  const fired = useRef(false);
  const state = data?.state;
  const minutes = data?.rules?.idleMinutes || 0;
  const action = data?.rules?.idleAction;
  const autoBreak = (data?.log?.breaks || []).find((b) => !b.end && b.auto);

  useEffect(() => {
    const onActivity = () => {
      last.current = Date.now();
      if (fired.current) {
        fired.current = false;
        if (autoBreak) setPrompt({ kind: "paused", since: autoBreak.start });
      }
    };
    ACTIVITY.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    return () => ACTIVITY.forEach((ev) => window.removeEventListener(ev, onActivity));
  }, [autoBreak, setPrompt]);

  useEffect(() => {
    if (state !== "WORKING" || minutes <= 0) return undefined;
    last.current = Date.now();
    const t = setInterval(() => {
      if (fired.current || Date.now() - last.current < minutes * 60000) return;
      fired.current = true;
      if (action === "PAUSE") act(() => reportIdle(new Date(last.current).toISOString()));
      else setPrompt({ kind: "remind" });
    }, 15000);
    return () => clearInterval(t);
  }, [state, minutes, action, act, setPrompt]);
}

function IdlePrompt({ prompt, tz, busy, act, onClose }) {
  return (
    <div className="att-idle" role="alertdialog" aria-label="Are you still working?">
      {prompt.kind === "remind" ? (
        <>
          <strong>Still working?</strong>
          <p>We haven't seen any activity in Prowosma for a while. You're still clocked in.</p>
          <div className="att-pop-actions">
            <button type="button" className="btn-primary pg-btn" onClick={onClose}>Yes, I'm working</button>
            <button type="button" className="btn-secondary pg-btn" disabled={busy} onClick={async () => { await act(() => startBreak("OTHER"), "Break started."); onClose(); }}>Start a break</button>
          </div>
        </>
      ) : (
        <>
          <strong>Welcome back</strong>
          <p>The clock paused at {timeIn(prompt.since, tz)} because there was no activity. Were you working?</p>
          <div className="att-pop-actions">
            <button type="button" className="btn-primary pg-btn" disabled={busy} onClick={async () => { await act(() => endBreak(true), "Counted as work."); onClose(); }}>Yes, count it as work</button>
            <button type="button" className="btn-secondary pg-btn" disabled={busy} onClick={async () => { await act(() => endBreak(false), "Kept as a break."); onClose(); }}>No, it was a break</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Once the shift has ended (plus the workspace's reminder minutes) and the person is still clocked in, remind them once. */
function useEndOfDayReminder(data, now) {
  const { show: toast } = useToast();
  const end = data?.today?.expectedEnd ? Date.parse(data.today.expectedEnd) : null;
  const after = (data?.rules?.endOfDayReminderMinutes ?? 15) * 60000;
  const due = !!(end && data?.state !== "OFF" && data?.rules?.endOfDayReminderMinutes > 0 && now > end + after);
  const key = `att-eod-${data?.date}`;
  useEffect(() => {
    if (!due) return;
    let shown = false;
    try { shown = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch { /* private mode: remind anyway */ }
    if (!shown) toast("Your shift has ended and you're still clocked in. Clock out from the top bar when you finish.", "info");
  }, [due, key, toast]);
  return due;
}
