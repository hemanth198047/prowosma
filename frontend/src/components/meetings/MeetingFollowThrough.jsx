import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookCheck, History, Link2, Loader2, NotebookPen, Pencil, ShieldAlert } from "lucide-react";
import {
  createUmaNotes, editUmaSummary, restoreUmaSummary, logUmaDecision, logUmaRisk, getUmaSimilarTasks,
  linkUmaActionToTask, getUmaContinuity, getUmaPrepare, getUmaOpenActions, getUmaTrends,
} from "../../api/aiMeetingAssistant";
import { useToast } from "../ToastContext";
import DueTag from "../ui/DueTag";
import { statusText } from "../../utils/statusText";
import { apiErrorMessage } from "../../utils/apiError";
import DateInput from "../DateInput";

/*
 * What Meetings took over from the old Meetings notes page and the first Meeting assistant:
 * writing notes by hand, the Decision / RAID logs, continuity between meetings of a project, trends,
 * editing the summary with its history, linking an action item to an existing task, and one list of
 * open action items across meetings.
 */

const MEETING_TYPES = [
  ["", "No type"], ["STANDUP", "Stand-up"], ["PLANNING", "Planning"], ["REVIEW", "Review"],
  ["RETRO", "Retrospective"], ["CLIENT", "Client"], ["ONE_ON_ONE", "One-on-one"], ["OTHER", "Other"],
];
export const meetingTypeLabel = (t) => (MEETING_TYPES.find(([k]) => k === t) || [null, null])[1];

const errText = (e, fallback) => apiErrorMessage(e, fallback);
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const shortDay = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }) : "");

/* ── Write notes by hand ───────────────────────────────────────────── */

export function NotesDialog({ Dialog, projects, initialProjectId = "", onClose, onDone }) {
  const { show: toast } = useToast();
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(nowLocal());
  const [projectId, setProjectId] = useState(initialProjectId);
  const [type, setType] = useState("");
  const [attendees, setAttendees] = useState("");
  const [agenda, setAgenda] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!notes.trim() && !agenda.trim()) return setError("Write the notes first.");
    setBusy(true);
    try {
      const r = await createUmaNotes({
        title: title.trim() || undefined, meetingAt: at ? new Date(at).toISOString() : undefined, timezone: tz(),
        projectId: projectId || undefined, meetingType: type || undefined,
        attendees: attendees.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
        agenda: agenda.trim() || undefined, notes: notes.trim() || undefined,
      });
      toast("Saved. Writing the summary now.", "success");
      onDone(r.data);
    } catch (err) {
      setError(errText(err, "The notes couldn't be saved."));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Write meeting notes" onClose={onClose} wide>
      <form onSubmit={submit} className="uma-form">
        <p className="uma-hint">Type the notes yourself. You'll get the same summary, decisions and action items as for a recording.</p>
        <div className="uma-form-row">
          <label className="uma-field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint planning, week 47" />
          </label>
          <label className="uma-field"><span>When</span>
            <DateInput type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
        </div>
        <div className="uma-form-row">
          <label className="uma-field"><span>Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="uma-field"><span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {MEETING_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="uma-field"><span>Attendees</span>
          <input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="alice@company.com, bob@company.com" />
        </label>
        <label className="uma-field"><span>Agenda</span>
          <textarea rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="One topic per line" />
        </label>
        <label className="uma-field"><span>Notes</span>
          <textarea rows={8} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={"What was discussed, decided and who will do what.\nRavi will finish the API by Friday."} />
        </label>
        {error && <p className="uma-error" role="alert">{error}</p>}
        <div className="uma-dialog-actions">
          <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary pg-btn" disabled={busy}>
            {busy ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : <NotebookPen size={14} aria-hidden="true" />}Save notes
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/* ── Summary: edit, history, restore ───────────────────────────────── */

export function SummaryEditor({ meetingId, ins, canManage, onChanged }) {
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(ins?.summary || "");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = [...(ins?.summaryHistory || [])].reverse();

  const save = async () => {
    setBusy(true);
    try { await editUmaSummary(meetingId, text); setEditing(false); onChanged(); toast("Summary saved.", "success"); }
    catch (e) { toast(errText(e, "The summary couldn't be saved."), "error"); }
    finally { setBusy(false); }
  };
  const restore = async (n) => {
    setBusy(true);
    try { await restoreUmaSummary(meetingId, n); setShowHistory(false); onChanged(); toast("Earlier version restored.", "success"); }
    catch (e) { toast(errText(e, "That version couldn't be restored."), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mft-summary">
      {editing ? (
        <>
          <textarea className="mft-summary-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Summary" />
          <div className="mft-row-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={() => { setEditing(false); setText(ins?.summary || ""); }} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary pg-btn" onClick={save} disabled={busy || !text.trim()}>Save summary</button>
          </div>
        </>
      ) : (
        <>
          <p className="uma-summary">{ins?.summary}</p>
          <div className="mft-meta">
            {ins?.summaryEdited && <span>Edited{ins.summaryEditedBy ? ` by ${ins.summaryEditedBy}` : ""}</span>}
            {canManage && <button type="button" className="mft-link" onClick={() => { setText(ins?.summary || ""); setEditing(true); }}><Pencil size={13} aria-hidden="true" />Edit</button>}
            {history.length > 0 && (
              <button type="button" className="mft-link" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
                <History size={13} aria-hidden="true" />Earlier versions <span className="mft-count">{history.length}</span>
              </button>
            )}
          </div>
          {showHistory && (
            <ol className="mft-history">
              {history.map((v) => (
                <li key={v.number}>
                  <div className="mft-history-head">
                    <span>Version {v.number} · {v.by === "ai" ? "written by the AI" : v.by} · {shortDay(v.at)}</span>
                    {canManage && <button type="button" className="mft-link" onClick={() => restore(v.number)} disabled={busy}>Restore</button>}
                  </div>
                  <p>{v.text}</p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/* ── Decision log / RAID log ───────────────────────────────────────── */

export function DecisionLogButton({ meetingId, decision, canManage, onChanged }) {
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (decision.loggedDecisionId) return <Link className="mft-tag" to="/decisions"><BookCheck size={12} aria-hidden="true" />In decision log</Link>;
  if (!canManage) return null;
  const add = async () => {
    setBusy(true);
    try { await logUmaDecision(meetingId, decision.id); toast("Added to the decision log.", "success"); onChanged(); }
    catch (e) { toast(errText(e, "It couldn't be added."), "error"); }
    finally { setBusy(false); }
  };
  return <button type="button" className="mft-link" onClick={add} disabled={busy}><BookCheck size={13} aria-hidden="true" />Add to decision log</button>;
}

export function RaidLogButton({ meetingId, finding, meetingProjectId, projects, canManage, onChanged }) {
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [projectId, setProjectId] = useState(meetingProjectId || "");
  if (finding.raidId) return <Link className="mft-tag" to="/roadmap"><ShieldAlert size={12} aria-hidden="true" />In RAID log</Link>;
  if (!canManage) return null;
  const add = async (pid) => {
    setBusy(true);
    try { await logUmaRisk(meetingId, finding.id, { projectId: pid || undefined }); toast("Added to the RAID log.", "success"); setPicking(false); onChanged(); }
    catch (e) { toast(errText(e, "It couldn't be added."), "error"); }
    finally { setBusy(false); }
  };
  if (picking) {
    return (
      <span className="mft-inline-pick">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project for the RAID log">
          <option value="">Choose a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="mft-link" disabled={!projectId || busy} onClick={() => add(projectId)}>Add</button>
        <button type="button" className="mft-link mft-link--quiet" onClick={() => setPicking(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button type="button" className="mft-link" disabled={busy} onClick={() => (meetingProjectId ? add(meetingProjectId) : setPicking(true))}>
      <ShieldAlert size={13} aria-hidden="true" />Add to RAID log
    </button>
  );
}

/* ── Action item → existing task ───────────────────────────────────── */

export function LinkTaskControl({ meetingId, action, onChanged }) {
  const { show: toast } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || items) return;
    getUmaSimilarTasks(meetingId, action.id).then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, [open, items, meetingId, action.id]);

  const link = async (taskId) => {
    setBusy(true);
    try { await linkUmaActionToTask(meetingId, action.id, taskId); toast("Linked to the existing task.", "success"); setOpen(false); onChanged(); }
    catch (e) { toast(errText(e, "It couldn't be linked."), "error"); }
    finally { setBusy(false); }
  };

  return (
    <span className="mft-linktask">
      <button type="button" className="btn-secondary pg-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Link2 size={14} aria-hidden="true" />Already a task?
      </button>
      {open && (
        <div className="mft-pop" role="dialog" aria-label="Link to an existing task">
          <p className="mft-pop-title">Open tasks like this one</p>
          {items === null && <p className="uma-hint"><Loader2 size={13} className="uma-spin" aria-hidden="true" /> Looking…</p>}
          {items?.length === 0 && <p className="uma-hint">No similar open tasks. Create a new one instead.</p>}
          {items?.length > 0 && (
            <ul>
              {items.map((t) => (
                <li key={t.id}>
                  <span className="mft-pop-task">{t.title}<small>{statusText(t.status)}</small></span>
                  <button type="button" className="mft-link" disabled={busy} onClick={() => link(t.id)}>Link</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}

/* ── Continuity: since last meeting, still open ────────────────────── */

function ContinuityBody({ data, title }) {
  if (!data) return null;
  const s = data.sinceLastMeeting || {};
  const o = data.stillOpen || {};
  const c = data.counts || {};
  const hasSince = (s.tasksDone?.length || 0) + (s.tasksStillOpen?.length || 0) + (s.newDecisions?.length || 0) + (s.newRisks?.length || 0) + (s.resolvedRisks?.length || 0) > 0;
  return (
    <section className="mft-card" aria-label={title}>
      <header className="mft-card-head">
        <h3 className="uma-h3">{title}</h3>
        {data.previousMeeting && (
          <span className="mft-fine">Last meeting: <Link to={`/meetings/${data.previousMeeting.id}`}>{data.previousMeeting.title}</Link> · {shortDay(data.previousMeeting.meetingAt)}</span>
        )}
      </header>
      <dl className="mft-counts">
        <div><dt>Open action items</dt><dd>{c.openActionItems || 0}</dd></div>
        <div className={c.overdueActionItems ? "is-late" : ""}><dt>Overdue</dt><dd>{c.overdueActionItems || 0}</dd></div>
        <div><dt>Blockers</dt><dd>{c.activeBlockers || 0}</dd></div>
        <div><dt>Risks</dt><dd>{c.activeRisks || 0}</dd></div>
        <div><dt>Open decisions</dt><dd>{c.openDecisions || 0}</dd></div>
      </dl>
      {data.previousMeeting && hasSince && (
        <div className="mft-since">
          <h4>Since the last meeting</h4>
          <ul>
            {s.tasksDone?.map((t) => <li key={`d${t.taskId}`}><span className="mft-dot mft-dot--done" aria-hidden="true" />Done: {t.title}</li>)}
            {s.tasksStillOpen?.map((t) => <li key={`o${t.taskId}`}><span className="mft-dot" aria-hidden="true" />Still open: {t.title} <small>{statusText(t.status)}</small></li>)}
            {s.newDecisions?.map((d) => <li key={`n${d.id}`}><span className="mft-dot" aria-hidden="true" />New decision: {d.title}</li>)}
            {s.newRisks?.map((r) => <li key={`r${r.id}`}><span className="mft-dot mft-dot--risk" aria-hidden="true" />New {r.type === "ISSUE" ? "blocker" : "risk"}: {r.title}</li>)}
            {s.resolvedRisks?.map((r) => <li key={`x${r.id}`}><span className="mft-dot mft-dot--done" aria-hidden="true" />Resolved: {r.title}</li>)}
          </ul>
        </div>
      )}
      {(o.blockers?.length > 0 || o.risks?.length > 0 || o.decisions?.length > 0) && (
        <div className="mft-since">
          <h4>Still open going in</h4>
          <ul>
            {o.blockers?.map((r) => <li key={`b${r.id}`}><span className="mft-dot mft-dot--risk" aria-hidden="true" />Blocker: {r.title}</li>)}
            {o.risks?.map((r) => <li key={`k${r.id}`}><span className="mft-dot mft-dot--risk" aria-hidden="true" />{statusText(r.type)}: {r.title}</li>)}
            {o.decisions?.map((d) => <li key={`q${d.id}`}><span className="mft-dot" aria-hidden="true" />Decision to make: {d.title}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

export function MeetingContinuity({ meetingId }) {
  const [data, setData] = useState(null);
  useEffect(() => { getUmaContinuity(meetingId).then((r) => setData(r.data)).catch(() => setData(null)); }, [meetingId]);
  if (!data?.projectId) return null;
  return <ContinuityBody data={data} title="Where this project stands" />;
}

export function WhereWeStand({ projects }) {
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!projectId) return;
    getUmaPrepare(projectId).then((r) => setData(r.data)).catch(() => setData(null));
  }, [projectId]);
  return (
    <section className="mft-prepare" aria-label="Prepare for a meeting">
      <div className="mft-prepare-head">
        <h2 className="pg-section-title">Before your next meeting</h2>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">Choose a project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {!projectId && <p className="uma-hint">See what changed since the project's last meeting and what is still open.</p>}
      {projectId && data && data.projectId === projectId && <ContinuityBody data={data} title="Where we stand" />}
    </section>
  );
}

/* ── Open action items across meetings ─────────────────────────────── */

export function OpenActionsList() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const load = () => getUmaOpenActions(undefined, 40).then((r) => setItems(r.data || [])).catch(() => setItems([]));
    load();
    window.addEventListener("uma:changed", load);
    return () => window.removeEventListener("uma:changed", load);
  }, []);
  if (items === null) return <p className="uma-hint" role="status"><Loader2 size={13} className="uma-spin" aria-hidden="true" /> Loading…</p>;
  const review = items.filter((r) => r.state === "NEEDS_REVIEW");
  const inTasks = items.filter((r) => r.state === "IN_TASKS");
  const row = (r) => (
    <li key={`${r.meetingId}:${r.action.id}`}>
      <Link to={r.state === "IN_TASKS" ? `/tasks?highlight=${r.action.createdTaskId}` : `/meetings/${r.meetingId}?tab=actions`}>{r.action.title}</Link>
      <span>
        {r.meetingTitle}
        {r.action.ownerSpoken ? ` · ${r.action.ownerSpoken}` : ""}
        {r.state === "IN_TASKS" && r.taskStatus ? ` · ${statusText(r.taskStatus)}` : ""}
        {(r.taskDueDate || r.action.dueDate) && <> · <DueTag date={r.taskDueDate || r.action.dueDate} overdue={!!r.overdue} /></>}
      </span>
    </li>
  );
  return (
    <>
      <h2 className="pg-section-title">Action items to review <span className="mft-count">{review.length}</span></h2>
      {review.length === 0 ? <p className="uma-hint">Nothing waiting.</p> : <ul className="uma-plist">{review.map(row)}</ul>}
      <h2 className="pg-section-title mft-gap">Open in tasks <span className="mft-count">{inTasks.length}</span></h2>
      {inTasks.length === 0 ? <p className="uma-hint">Every task from a meeting is done.</p> : <ul className="uma-plist">{inTasks.map(row)}</ul>}
    </>
  );
}

/* ── Trends ────────────────────────────────────────────────────────── */

export function MeetingTrends() {
  const [rows, setRows] = useState(null);
  useEffect(() => { getUmaTrends(28).then((r) => setRows(r.data || [])).catch(() => setRows([])); }, []);
  if (!rows?.length) return null;
  const total = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.meetings));
  return (
    <section className="mft-trends" aria-label="Meetings in the last four weeks">
      <h2 className="pg-section-title">Last four weeks</h2>
      <dl className="mft-counts">
        <div><dt>Meetings</dt><dd>{total("meetings")}</dd></div>
        <div><dt>Action items found</dt><dd>{total("actionItems")}</dd></div>
        <div><dt>Turned into tasks</dt><dd>{total("tasksCreated")}</dd></div>
        <div><dt>Decisions</dt><dd>{total("decisions")}</dd></div>
      </dl>
      <div className="mft-bars" role="img" aria-label={`Meetings per day, at most ${max} in a day`}>
        {rows.map((r) => (
          <span key={r.date} className="mft-bar" style={{ height: `${Math.max(2, (r.meetings / max) * 100)}%` }}
            title={`${shortDay(r.date)}: ${r.meetings} meeting${r.meetings === 1 ? "" : "s"}`} data-empty={r.meetings === 0 || undefined} />
        ))}
      </div>
      <div className="mft-bars-axis"><span>{shortDay(rows[0].date)}</span><span>Today</span></div>
    </section>
  );
}
