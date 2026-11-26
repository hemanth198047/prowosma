import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, BellRing, Coffee, LogOut, Play } from "lucide-react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { clockOut, endBreak, startBreak } from "../api/attendance";
import { ClockInForm } from "./ClockWidget";
import { BREAK_LABEL, currentPosition, hm, hms, publishMyAttendance, timeIn, useAttendanceEnabled, useMyAttendance, workedMs } from "../hooks/useAttendance";
import "../styles/pages/attendance.css";

/**
 * Attendance on the dashboard, for everyone: where you stand today (not in / working / on a break / done), the clock-in form right here
 * when you have not clocked in, and a clear reminder once your start time has passed. The same clock as the top bar, so they always agree.
 */
export default function AttendanceCard() {
  const enabled = useAttendanceEnabled();
  const data = useMyAttendance(enabled);
  const { show: toast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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

  if (!enabled) return null;
  if (!data) return <section className="dz-card att-card" aria-label="Attendance"><p className="att-sub">Loading attendance…</p></section>;

  const { state, log, today, rules, timezone: tz } = data;
  const sessions = log?.sessions || [];
  const openBreak = (log?.breaks || []).find((b) => !b.end);
  const worked = workedMs(log, now);
  const late = state === "OFF" && !sessions.length && today?.dayType === "WORKDAY" && !today?.onLeave && !!today?.expectedStart
    && now > Date.parse(today.expectedStart) + (today.graceMinutes || 0) * 60000;

  return (
    <section className="dz-card att-card" aria-label="Attendance">
      <header className="att-card-head">
        <h2 className="att-card-title"><AlarmClock size={16} aria-hidden="true" /> Attendance</h2>
        <Link to="/attendance" className="att-card-link">Open</Link>
      </header>

      {late && (
        <p className="att-note att-note--warn" role="alert">
          <BellRing size={14} aria-hidden="true" /> You haven't clocked in yet. Your day started at {timeIn(today.expectedStart, tz)}.
        </p>
      )}

      {state === "OFF" && !sessions.length && <ClockInForm data={data} busy={busy} act={act} onDone={() => {}} />}

      {state === "OFF" && sessions.length > 0 && (
        <p className="att-sub">You're clocked out. You worked {hm(Math.round(worked / 60000))} today.</p>
      )}

      {(state === "WORKING" || state === "ON_BREAK") && (
        <>
          <p className="att-card-timer">
            {state === "WORKING" ? <>Clocked in · <strong>{hms(worked)}</strong> worked</> : <>On a {BREAK_LABEL[openBreak?.type] || "break"} · <strong>{hms(now - Date.parse(openBreak?.start || now))}</strong></>}
          </p>
          <div className="att-pop-actions">
            {state === "WORKING"
              ? <button type="button" className="btn-secondary pg-btn" disabled={busy} onClick={() => act(() => startBreak("LUNCH"), "Break started.")}><Coffee size={14} aria-hidden="true" />Take a break</button>
              : <button type="button" className="btn-primary pg-btn" disabled={busy} onClick={() => act(() => endBreak(false), "Welcome back.")}><Play size={14} aria-hidden="true" />End break</button>}
            <button type="button" className="btn-secondary pg-btn att-out" disabled={busy}
              onClick={async () => {
                const pos = rules?.locationMode === "OFF" ? null : await currentPosition();
                await act(() => clockOut(pos || {}), "Clocked out. See you tomorrow.");
              }}><LogOut size={14} aria-hidden="true" />Clock out</button>
          </div>
        </>
      )}
    </section>
  );
}
