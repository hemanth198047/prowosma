import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Play, Square, Timer } from "lucide-react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { elapsed, hoursText, startOn, stopNow, useNow, useWorkTimer } from "../hooks/useWorkTimer";
import { exportTime, getProjectTime } from "../api/workSessions";
import "../styles/work-timer.css";

/** Top bar / phone header: what you're working on, for how long, and Stop. Nothing when no timer runs. */
export function WorkTimerChip({ compact = false }) {
  const { running } = useWorkTimer();
  const now = useNow(!!running);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!running) return null;
  const stop = async () => {
    setBusy(true);
    try { const s = await stopNow(); toast.show(s ? `Stopped: ${hoursText(s.minutes)} on ${s.projectName}` : "Stopped", "success"); }
    catch (e) { toast.show(apiErrorMessage(e, "Couldn't stop the timer."), "error"); }
    setBusy(false);
  };
  return (
    <div className={"wt-chip" + (compact ? " wt-chip--compact" : "")} role="status" aria-label={`Working on ${running.projectName}`}>
      <span className="wt-dot" aria-hidden="true" />
      <Link to={`/projects?highlight=${running.projectId}`} className="wt-chip-name" title={running.projectName}>{running.projectName}</Link>
      <span className="wt-chip-time">{elapsed(running.startedAt, now)}</span>
      <button type="button" className="wt-stop" onClick={stop} disabled={busy} aria-label={`Stop working on ${running.projectName}`}>
        <Square size={12} aria-hidden="true" />{!compact && " Stop"}
      </button>
    </div>
  );
}

/** Desktop top bar: the running timer takes the clock's place (the bar has no room for both). */
export function TimerOrClock({ children }) {
  const { running } = useWorkTimer();
  return running ? <WorkTimerChip /> : children;
}

/** Phones: a full-width strip under the header while a timer runs. */
export function WorkTimerStrip() {
  const { running } = useWorkTimer();
  if (!running) return null;
  return <div className="wt-strip"><WorkTimerChip /></div>;
}

/** On a project: "Start working", or "Stop" with the time when it's the one running. */
export function ProjectWorkButton({ project }) {
  const { running } = useWorkTimer();
  const mine = running && running.projectId === project.id;
  const now = useNow(!!mine);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (project.archived) return null;
  const go = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      if (mine) { const s = await stopNow(); toast.show(s ? `Stopped: ${hoursText(s.minutes)} on ${s.projectName}` : "Stopped", "success"); }
      else {
        const was = running?.projectName;
        await startOn(project.id);
        toast.show(was ? `Switched from ${was} to ${project.name}` : `Started working on ${project.name}`, "success");
      }
    } catch (err) { toast.show(apiErrorMessage(err, "Couldn't change the timer."), "error"); }
    setBusy(false);
  };
  return mine ? (
    <button type="button" className="wt-btn wt-btn--on" onClick={go} disabled={busy} aria-label={`Stop working on ${project.name}`}>
      <Square size={13} aria-hidden="true" /> Stop <span className="wt-btn-time">{elapsed(running.startedAt, now)}</span>
    </button>
  ) : (
    <button type="button" className="wt-btn" onClick={go} disabled={busy} aria-label={`Start working on ${project.name}`}>
      <Play size={13} aria-hidden="true" /> Start working
    </button>
  );
}

const RANGES = [["7", "Last 7 days"], ["30", "Last 30 days"], ["0", "All time"]];

/** Hours per person on one project. Managers see everyone; others see their own. */
export function ProjectTimePanel({ project }) {
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const { running } = useWorkTimer();
  useEffect(() => {
    let alive = true;
    getProjectTime(project.id, { days })
      .then((r) => { if (alive) { setData(r.data); setError(""); } })
      .catch((e) => { if (alive) setError(apiErrorMessage(e, "Couldn't load the time.")); });
    return () => { alive = false; };
  }, [project.id, days, running?.id]);
  const download = async () => {
    try {
      const r = await exportTime({ projectId: project.id, days });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${project.name.replace(/[^\w-]+/g, "-")}-time.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(apiErrorMessage(e, "Couldn't export.")); }
  };
  return (
    <div className="wt-panel">
      <div className="wt-panel-head">
        <span className="wt-panel-title"><Timer size={15} aria-hidden="true" /> Time on this project</span>
        <select className="wt-range" aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" className="wt-link" onClick={download}><Download size={13} aria-hidden="true" /> Export</button>
      </div>
      {error && <p className="wt-error" role="alert">{error}</p>}
      {!data && !error && <p className="wt-muted">Loading…</p>}
      {data && data.people.length === 0 && <p className="wt-muted">Nobody has tracked time here in this period. Use <strong>Start working</strong> on the project.</p>}
      {data && data.people.length > 0 && (
        <>
          <ul className="wt-people">
            {data.people.map((p) => (
              <li key={p.email}>
                <span className="wt-person">{p.name || p.email}{p.workingNow && <span className="wt-now"><span className="wt-dot" aria-hidden="true" /> working now</span>}</span>
                <span className="wt-hours">{hoursText(p.minutes)}</span>
                <span className="wt-sub">{p.sessions} {p.sessions === 1 ? "session" : "sessions"} · last {new Date(p.lastWorked).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
          <p className="wt-total">Total {hoursText(data.totalMinutes)}{!data.everyone && " (only your own time is shown)"}</p>
        </>
      )}
    </div>
  );
}
