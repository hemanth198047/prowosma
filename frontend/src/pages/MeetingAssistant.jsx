import { useState, useEffect, useCallback, useRef } from "react";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useRole } from "../hooks/useRole";
import { useConfirm } from "../hooks/useConfirm";
import MeetingArtifactPanel from "../components/MeetingArtifactPanel";
import { MeetingActionsPanel, MeetingProjectsTasksPanel } from "../components/MeetingActionsPanel";
import MeetingCheckStatus from "../components/MeetingCheckStatus";
import GoogleMeetTranscriptGuide from "../components/GoogleMeetTranscriptGuide";
import RecordMeetingPanel from "../components/RecordMeetingPanel";
import RecordingUpload from "../components/RecordingUpload";
import RecordingSettingsCard from "../components/RecordingSettingsCard";
import SessionRecordingInfo from "../components/SessionRecordingInfo";
import FirefliesPanel from "../components/FirefliesPanel";
import UploadTranscriptPanel from "../components/UploadTranscriptPanel";
import FirefliesSettingsCard from "../components/FirefliesSettingsCard";
import SessionFirefliesInfo from "../components/SessionFirefliesInfo";
import { apiErrorMessage } from "../utils/apiError";
import {
  getAssistantCapabilities, validateMeetingUrl, listMeetingSessions, createMeetingSession,
  cancelMeetingSession, retryMeetingSession, updateMeetingAccess, devAdvanceMeetingSession,
  addMeetingTranscript, getMeetingTranscript, deleteMeetingTranscript, fetchMeetingTranscriptNow, generateMeetingOutputs,
} from "../api/meetingAssistant";
import { getProjects } from "../api/projects";
import { getTeamMembers } from "../api/team";
import {
  ALL_STATUSES, statusMeta, providerName, isActiveStatus, canCancelSession, canRetrySession,
  submitLabel, localInputValue, formatClock, ACCEPTS_TRANSCRIPT, WAITING_FOR_TRANSCRIPT, MAX_UPLOAD_BYTES,
} from "../utils/meetingStatus";
import "../styles/pages/meeting-assistant.css";
import "../styles/pages/meeting-assistant-v2.css";
import { Bot, FileText, Info, Link2, Mic, Plus } from "lucide-react";

const TABS = ["Summary", "MOM", "Notes", "Transcript", "Actions", "Projects and Tasks"];
const DOC_TYPE = { Summary: "SUMMARY", MOM: "MOM", Notes: "NOTES" };
const toList = (res) => {
  const d = res?.data;
  return Array.isArray(d) ? d : d?.content || d?.items || [];
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

function StatusChip({ status }) {
  const m = statusMeta(status);
  return <span className={`ma-chip ${m.tone}`}><span className="ma2-dot" aria-hidden="true" />{m.label}</span>;
}

/* ── Transcript viewer. Shows exactly what was stored: speakers as the source named them (unknown stays
      unknown), and a plain note about how complete the capture is. ── */
function TranscriptPanel({ session, onChanged }) {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const count = session.segmentCount || 0;

  useEffect(() => {
    let live = true;
    (async () => {
      if (!count) return;
      try {
        const res = await getMeetingTranscript(session.id, { after: 0, limit: 200 });
        if (live) { setData(res.data); setLoadError(""); }
      } catch (e) { if (live) setLoadError(apiErrorMessage(e, "Couldn't load the transcript.")); }
    })();
    return () => { live = false; };
  }, [session.id, count, session.transcriptReceivedAt]);

  const shown = count ? data : null;

  const loadMore = async () => {
    setBusy(true);
    try {
      const res = await getMeetingTranscript(session.id, { after: shown.nextAfter, limit: 200 });
      setData((d) => ({ ...res.data, segments: [...d.segments, ...res.data.segments] }));
    } catch (e) { toast(apiErrorMessage(e, "Couldn't load more."), "error"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirm({ title: "Delete this transcript?",
      message: "The text is removed. The meeting stays, and you can add a transcript again.", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await deleteMeetingTranscript(session.id); toast("Transcript deleted", "success"); await onChanged(); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't delete the transcript."), "error"); }
    finally { setBusy(false); }
  };

  if (session.transcriptRemovedByRetention) {
    return <div className="ma-empty">{session.transcriptNote || "The transcript text was removed under your retention policy."}</div>;
  }
  if (!count) return <div className="ma-empty">No transcript has been collected for this meeting, so there is nothing to show here yet.</div>;
  if (loadError) return <p className="ma-error" role="alert">{loadError}</p>;
  if (!shown) return <p className="ma-hint">Loading the transcript…</p>;

  const tone = shown.captureStatus === "PARTIAL" ? "warn" : shown.captureStatus === "FULL" ? "ok" : "";
  return (
    <div>
      <p className={`ma-note ${tone}`}>
        {shown.captureStatus === "PARTIAL" && <strong>This transcript may be incomplete. </strong>}
        {shown.captureStatus === "FULL" && "Imported from Google Meet. "}
        {shown.note}
      </p>
      <p className="ma-hint">{shown.total} lines. Speakers are shown as the source named them; unlabeled speech is marked unknown.</p>
      <ol className="ma-transcript" aria-label="Transcript">
        {shown.segments.map((seg) => (
          <li key={seg.seq} className="ma-line">
            <span className="ma-time">{formatClock(seg.startMs)}</span>
            <span>
              <span className={seg.speaker ? "ma-speaker" : "ma-speaker unknown"}>{seg.speaker || "Unknown speaker"}</span>
              {seg.text}
            </span>
          </li>
        ))}
      </ol>
      <div className="ma-actions">
        {shown.nextAfter != null && <button className="ma-btn" disabled={busy} onClick={loadMore}>Load more</button>}
        {session.canManage && <button className="ma-btn danger" disabled={busy} onClick={remove}>Delete transcript</button>}
      </div>
    </div>
  );
}

function ResultTabs({ session, members, projects, aiReady, aiReason, onChanged }) {
  const [tab, setTab] = useState(TABS[0]);
  const onKey = (e) => {
    const i = TABS.indexOf(tab);
    let next = null;
    if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
    if (e.key === "ArrowLeft") next = TABS[(i - 1 + TABS.length) % TABS.length];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`ma-tab-${next}`)?.focus();
  };
  const hasTranscript = (session.segmentCount || 0) > 0;
  return (
    <>
      <div className="ma-tabs" role="tablist" aria-label="Meeting results">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`ma-tab-${t}`} aria-selected={tab === t} aria-controls="ma-panel"
            tabIndex={tab === t ? 0 : -1} className="ma-tab" onKeyDown={onKey} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div id="ma-panel" role="tabpanel" aria-labelledby={`ma-tab-${tab}`}>
        {tab === "Transcript" ? <TranscriptPanel session={session} onChanged={onChanged} />
          : DOC_TYPE[tab] ? <MeetingArtifactPanel session={session} type={DOC_TYPE[tab]} aiReady={aiReady} aiReason={aiReason} onChanged={onChanged} />
          : !hasTranscript ? <div className="ma-empty">No transcript has been collected for this meeting, so there is nothing to show here yet.</div>
          : tab === "Actions" ? <MeetingActionsPanel session={session} members={members} projects={projects} aiReady={aiReady} aiReason={aiReason} onChanged={onChanged} />
          : <MeetingProjectsTasksPanel session={session} onChanged={onChanged} />}
      </div>
    </>
  );
}

/* ── Add or replace a transcript: paste text or choose a .vtt / .srt / .txt file. ── */
function AddTranscript({ session, onChanged }) {
  const { show: toast } = useToast();
  const [text, setText] = useState("");
  const [format, setFormat] = useState("AUTO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const replacing = (session.segmentCount || 0) > 0;

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_UPLOAD_BYTES) { setError("That file is larger than 5 MB. Split it into parts and add them one at a time."); return; }
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(""); setWarnings([]);
    try {
      const { data } = await addMeetingTranscript(session.id, { content: text, format: format === "AUTO" ? null : format });
      setWarnings(data.warnings || []);
      setText("");
      toast(replacing ? "Transcript replaced" : "Transcript added", "success");
      await onChanged();
    } catch (err) { setError(apiErrorMessage(err, "Couldn't add the transcript.")); }
    finally { setBusy(false); }
  };

  return (
    <form className="ma-card" onSubmit={submit} aria-label={replacing ? "Replace transcript" : "Add transcript"}>
      <strong>{replacing ? "Replace the transcript" : "Add a transcript"}</strong>
      <p className="ma-hint">Paste the text or choose a .vtt, .srt or .txt file. Nothing is changed until you press the button.
        {session.status === "READY_FOR_REVIEW" && " Replacing the transcript marks the summary, minutes and notes as out of date; they are kept until you generate new ones."}</p>
      <div className="ma-field">
        <label htmlFor="ma-tr-file">Transcript file</label>
        <input id="ma-tr-file" type="file" accept=".vtt,.srt,.txt,text/plain,text/vtt" onChange={onFile} />
      </div>
      <div className="ma-field">
        <label htmlFor="ma-tr-text">Or paste the transcript</label>
        <textarea id="ma-tr-text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="ma-field">
        <label htmlFor="ma-tr-format">Format</label>
        <select id="ma-tr-format" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="AUTO">Detect automatically</option>
          <option value="VTT">WebVTT (.vtt)</option>
          <option value="SRT">SubRip (.srt)</option>
          <option value="TEXT">Plain text</option>
        </select>
      </div>
      {error && <p className="ma-error" role="alert">{error}</p>}
      {warnings.length > 0 && <p className="ma-warn" role="status">{warnings.join(" ")}</p>}
      <button type="submit" className="ma-btn primary" disabled={busy || !text.trim()}>
        {busy ? "Adding…" : replacing ? "Replace transcript" : "Add transcript"}
      </button>
    </form>
  );
}

function SessionDetail({ session, members, projects, isAdmin, devEnabled, googleConnected, aiReady, aiReason, recordingCaps, firefliesCaps, onChanged, onClose }) {
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [devStatus, setDevStatus] = useState("PROCESSING");

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg, "success"); await onChanged(); }
    catch (e) { toast(apiErrorMessage(e, "That didn't work. Please try again."), "error"); }
    finally { setBusy(false); }
  };

  const toggleShare = (email) => {
    const cur = session.sharedWith || [];
    const next = cur.includes(email) ? cur.filter((x) => x !== email) : [...cur, email];
    run(() => updateMeetingAccess(session.id, { sharedWith: next }), "Access updated");
  };

  const waiting = WAITING_FOR_TRANSCRIPT.includes(session.status);
  const hasTranscript = (session.segmentCount || 0) > 0;
  const canAddTranscript = session.canManage && !session.simulated && ACCEPTS_TRANSCRIPT.includes(session.status);

  return (
    <section className="ma-card ma2-detail" aria-label={`Details for ${session.title}`}>
      {/* 1 — what this meeting is and where it stands */}
      <header className="ma2-detail-head">
        <div className="ma2-detail-title">
          <h2>{session.title}</h2>
          <div className="ma-meta">{providerName(session.provider)} · requested by {session.requestedBy}</div>
        </div>
        <button className="ma-btn" onClick={onClose}>Close</button>
      </header>
      <p className="ma2-status" aria-live="polite"><StatusChip status={session.status} /> <span>{session.statusDetail}</span></p>

      {session.status === "FAILED" && (
        <div className="ma-failure" role="alert">
          <strong>What happened:</strong> {session.statusDetail}
          {session.recoveryAction && <div><strong>What you can do:</strong> {session.recoveryAction}</div>}
        </div>
      )}

      <div className="ma-actions">
        {canRetrySession(session) && (
          <button className="ma-btn primary" disabled={busy}
            onClick={() => run(() => retryMeetingSession(session.id), "Retrying")}>Retry</button>)}
        {session.canGenerate && aiReady && session.status === "READY_FOR_REVIEW" && (
          <button className="ma-btn" disabled={busy}
            onClick={() => run(() => generateMeetingOutputs(session.id), "Generating a new version")}>Regenerate</button>)}
        {session.canManage && googleConnected && session.provider === "GOOGLE_MEET" && waiting && (
          <button className="ma-btn" disabled={busy}
            onClick={() => run(() => fetchMeetingTranscriptNow(session.id), "Checked Google Meet")}>{busy ? "Checking Google…" : "Check Google Meet now"}</button>)}
        {canCancelSession(session) && (
          <button className="ma-btn danger" disabled={busy}
            onClick={() => run(() => cancelMeetingSession(session.id), "Cancelled")}>Cancel</button>)}
      </div>

      {/* 2 — while it waits: how the transcript will arrive, and the one next step */}
      {(waiting || session.status === "FAILED") && !session.simulated && (
        <div className="ma2-waiting">
          {waiting && <MeetingCheckStatus session={session} />}
          {session.provider === "GOOGLE_MEET" && (
            <GoogleMeetTranscriptGuide defaultOpen={session.status === "FAILED" || session.lastCheck?.code === "NO_TRANSCRIPT_YET"} />
          )}
        </div>
      )}
      <SessionRecordingInfo session={session} onChanged={onChanged} />
      <SessionFirefliesInfo session={session} firefliesCaps={firefliesCaps} waiting={waiting} onChanged={onChanged} />

      {canAddTranscript && !hasTranscript && (
        <div className="ma2-next">
          <AddTranscript session={session} onChanged={onChanged} />
          {recordingCaps?.ready && (waiting || session.status === "FAILED")
            && (!session.recording || ["DELETED", "EXPIRED"].includes(session.recording.state)) && (
            <details className="ma-guide">
              <summary>Have a recording of this meeting? Upload it</summary>
              <div className="ma-guide-body"><RecordingUpload recording={recordingCaps} sessionId={session.id} onDone={onChanged} /></div>
            </details>
          )}
        </div>
      )}

      {/* 3 — the results */}
      <ResultTabs session={session} members={members} projects={projects} aiReady={aiReady} aiReason={aiReason} onChanged={onChanged} />

      {/* 4 — less frequent things, folded away */}
      <div className="ma2-more">
        {canAddTranscript && hasTranscript && (
          <details className="ma2-fold">
            <summary>Replace the transcript</summary>
            <div className="ma2-fold-body"><AddTranscript session={session} onChanged={onChanged} /></div>
          </details>
        )}
        {session.canManage && (
          <details className="ma2-fold">
            <summary>Who can see this meeting</summary>
            <fieldset className="ma2-fold-body" style={{ border: 0, margin: 0 }}>
              <legend className="sr-only">Who can open the results</legend>
              <p className="ma-hint">Being in the meeting doesn't give access. Choose who can see this one.</p>
              <div className="ma-field">
                <label htmlFor="ma-vis">Visibility</label>
                <select id="ma-vis" value={session.visibility} disabled={busy}
                  onChange={(e) => run(() => updateMeetingAccess(session.id, { visibility: e.target.value }), "Access updated")}>
                  <option value="PRIVATE">Only me, the people below, and admins</option>
                  <option value="WORKSPACE">Everyone in this workspace</option>
                </select>
              </div>
              <div className="ma-checks">
                {members.filter((m) => m.email && m.email.toLowerCase() !== (session.requestedBy || "").toLowerCase()).map((m) => (
                  <label key={m.id || m.email}>
                    <input type="checkbox" disabled={busy} checked={(session.sharedWith || []).includes(m.email.toLowerCase())}
                      onChange={() => toggleShare(m.email.toLowerCase())} />
                    {m.name || m.email}
                  </label>
                ))}
              </div>
            </fieldset>
          </details>
        )}
        <details className="ma2-fold">
          <summary>History</summary>
          <ol className="ma-timeline ma2-fold-body">
            {(session.history || []).length === 0 && <li>No changes yet.</li>}
            {(session.history || []).map((h, i) => (
              <li key={i}>{fmt(h.at)} — {statusMeta(h.to).label}{h.note ? ` (${h.note})` : ""}</li>
            ))}
          </ol>
        </details>
        {session.simulated && devEnabled && isAdmin && (
          <details className="ma2-fold">
            <summary>Simulation controls (development only)</summary>
            <div className="ma2-fold-body">
              <p className="ma-hint">Moves this simulated meeting through the lifecycle. No real meeting is involved.</p>
              <div className="ma-field">
                <label htmlFor="ma-dev">Move to</label>
                <select id="ma-dev" value={devStatus} onChange={(e) => setDevStatus(e.target.value)}>
                  {ALL_STATUSES.map((st) => <option key={st} value={st}>{statusMeta(st).label}</option>)}
                </select>
              </div>
              <button className="ma-btn" disabled={busy}
                onClick={() => run(() => devAdvanceMeetingSession(session.id, devStatus), "Updated")}>Apply</button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

export default function MeetingAssistant() {
  const { show: toast } = useToast();
  const { isAdmin, isOwner } = useRole();
  const admin = !!(isAdmin || isOwner);

  const [caps, setCaps] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  // A link like /meeting-assistant?session=<id> (written into every created task and project) opens that meeting.
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("session"));

  const [url, setUrl] = useState("");
  const [result, setResult] = useState(null); // answer for one specific link: { url, ok, data }
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(() => new URLSearchParams(window.location.search).get("project") || "");
  const [when, setWhen] = useState("now");
  const [scheduled, setScheduled] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [way, setWay] = useState("upload");
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    try { setSessions(toList(await listMeetingSessions())); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't load meetings."), "error"); }
  }, [toast]);

  const reloadCaps = useCallback(async () => {
    try { setCaps((await getAssistantCapabilities()).data); } catch { /* keep what we have */ }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const [c, , p, m] = await Promise.allSettled([
        getAssistantCapabilities(), refresh(), getProjects(), getTeamMembers(),
      ]);
      if (!live) return;
      if (c.status === "fulfilled") setCaps(c.value.data);
      if (p.status === "fulfilled") setProjects(toList(p.value));
      if (m.status === "fulfilled") setMembers(toList(m.value));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [refresh]);

  // Keep statuses fresh while anything is still in flight.
  useEffect(() => {
    if (!sessions.some((s) => isActiveStatus(s.status))) return undefined;
    const t = setInterval(refresh, sessions.some((s) => s.status === "PROCESSING" || s.actionsStatus === "RUNNING") ? 4000 : 15000);
    return () => clearInterval(t);
  }, [sessions, refresh]);

  // Validate the pasted link on the server (single source of truth), ignoring stale answers.
  const trimmedUrl = url.trim();
  useEffect(() => {
    if (!trimmedUrl) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await validateMeetingUrl(trimmedUrl);
        if (mine === seq.current) setResult({ url: trimmedUrl, ok: !!data.valid, data });
      } catch (e) {
        if (mine === seq.current) setResult({ url: trimmedUrl, ok: false, data: { message: apiErrorMessage(e, "Couldn't check that link.") } });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [trimmedUrl]);

  // "checking" means: no answer yet for the link currently in the box.
  let check = { state: "idle" };
  if (trimmedUrl) {
    check = result?.url === trimmedUrl ? { state: result.ok ? "ok" : "bad", data: result.data } : { state: "checking" };
  }

  const providerOff = check.state === "ok" && check.data.providerEnabled === false;
  const needsTime = when === "later" && !scheduled;
  const canSubmit = check.state === "ok" && !providerOff && !needsTime && !submitting;

  const submit = async (e) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const { data } = await createMeetingSession({
        meetingUrl: url.trim(),
        title: title.trim(),
        projectId: projectId || null,
        scheduledFor: when === "later" ? new Date(scheduled).toISOString() : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        simulated,
      });
      toast("Meeting registered", "success");
      setUrl(""); setTitle(""); setProjectId(""); setWhen("now"); setScheduled(""); setSimulated(false);
      await refresh();
      setSelectedId(data.id);
    } catch (err) {
      setFormError(apiErrorMessage(err, "Couldn't register this meeting."));
      const existing = err?.response?.data?.existingSessionId;
      if (existing) setSelectedId(existing);
    } finally { setSubmitting(false); }
  };

  const selected = sessions.find((s) => s.id === selectedId);
  const label = submitLabel(caps);
  const live = caps?.platforms?.some((p) => p.liveJoin);
  const googlePlatform = caps?.platforms?.find((p) => p.provider === "GOOGLE_MEET");
  const googleEnabled = !!googlePlatform?.enabled;
  const googleConnected = !!googlePlatform?.connectedForMe;

  // Ways to bring a meeting in. Only the ones this workspace can actually use are offered.
  const recordingReady = !!caps?.recording?.ready;
  const firefliesReady = !!caps?.fireflies?.ready;
  const ways = [
    { id: "upload", icon: FileText, title: "Upload a transcript",
      desc: "Already have the text from Meet, Teams or Zoom? Paste it or choose a file.", recommended: !live },
    ...(recordingReady ? [{ id: "record", icon: Mic, title: "Record in your browser",
      desc: "Prowosma records the meeting tab's audio and writes the transcript." }] : []),
    ...(firefliesReady ? [{ id: "fireflies", icon: Bot, title: "Send a notetaker",
      desc: "A Fireflies notetaker joins the call and brings the transcript back." }] : []),
    { id: "link", icon: Link2, title: live ? "Send the assistant" : "Register a meeting link",
      desc: live ? "Paste a Meet or Teams link and the assistant joins the call." : "Save a Meet or Teams link now, add the transcript after." },
  ];
  const openCreated = async (id) => { await refresh(); setSelectedId(id); };

  const registerForm = (
    <form className="ma-card ma2-way-panel" onSubmit={submit} aria-label="Register a meeting" noValidate>
      <h2>{live ? "Send the assistant to a meeting" : "Register a meeting link"}</h2>
      {caps && !live && (
        <div className="ma-banner" role="note">
          <Info size={16} aria-hidden="true" />
          <span>{caps.note}</span>
        </div>
      )}
      {caps?.googleConfigured && googleEnabled && !googleConnected && (
        <div className="ma-banner ma2-banner-soft" role="note">
          <Link2 size={16} aria-hidden="true" />
          <span>Connect your Google account to import Google Meet transcripts automatically.{" "}
            <a href="/integrations/meeting-platforms">Connect Google</a></span>
        </div>
      )}

      <div className="ma-field">
        <label htmlFor="ma-url">Meeting link</label>
        <input id="ma-url" type="url" inputMode="url" autoComplete="off" placeholder="Paste a Meet or Teams link"
          value={url} onChange={(e) => setUrl(e.target.value)}
          aria-invalid={check.state === "bad"} aria-describedby="ma-url-status" />
        <div id="ma-url-status" aria-live="polite">
          {check.state === "checking" && <span className="ma-hint">Checking…</span>}
          {check.state === "ok" && <span className="ma-ok">✓ {providerName(check.data.provider)} link</span>}
          {check.state === "bad" && <span className="ma-error">{check.data?.message}</span>}
          {check.state === "ok" && check.data.warning && <div className="ma-warn">{check.data.warning}</div>}
          {providerOff && <div className="ma-error">This platform isn't enabled yet. Ask an admin to turn it on under Integrations → Meeting Platforms.</div>}
        </div>
      </div>

      <div className="ma2-two">
        <div className="ma-field">
          <label htmlFor="ma-title">Title (optional)</label>
          <input id="ma-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="ma-field">
          <label htmlFor="ma-project">Project</label>
          <select id="ma-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Detect from discussion</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ma-legend">When</legend>
        <div className="ma-radio">
          <label><input type="radio" name="ma-when" checked={when === "now"} onChange={() => setWhen("now")} /> Now</label>
          <label><input type="radio" name="ma-when" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule</label>
        </div>
        {when === "later" && (
          <div className="ma-field">
            <label htmlFor="ma-when-at">Start time</label>
            <input id="ma-when-at" type="datetime-local" min={localInputValue()} value={scheduled}
              onChange={(e) => setScheduled(e.target.value)} />
          </div>
        )}
      </fieldset>

      {(check.state === "ok" ? check.data.provider === "GOOGLE_MEET" : !url.trim()) && <GoogleMeetTranscriptGuide title="Before you start your meeting: how to turn on a transcript in Google Meet" />}

      {caps?.devFixturesEnabled && admin && (
        <label className="ma-hint" style={{ display: "block", margin: "8px 0" }}>
          <input type="checkbox" checked={simulated} onChange={(e) => setSimulated(e.target.checked)} /> Create as a simulated meeting (development)
        </label>
      )}

      {formError && <p className="ma-error" role="alert">{formError}</p>}
      <div className="ma2-submit">
        <button type="submit" className="ma-btn primary" disabled={!canSubmit}>{submitting ? "Working…" : label}</button>
        {!live && <span className="ma-hint">This saves the meeting. It doesn't send anything into the call.</span>}
      </div>
    </form>
  );

  return (
    <div className="ma2-page">
      <PageHeader title="Meeting Assistant"
        description="Turn a meeting into a summary, minutes, tasks and projects. You review everything before anything is created."
        action={selected ? (
          <button type="button" className="btn-primary pg-btn" onClick={() => setSelectedId(null)}>
            <Plus size={15} aria-hidden="true" />Add a meeting
          </button>
        ) : null} />

      <div className="ma2-layout">
        {/* Your meetings — always in view */}
        <section className="ma2-list" aria-label="Your meetings">
          <h2 className="pg-section-title">Your meetings <span>· {sessions.length}</span></h2>
          {loading ? <p className="ma-hint">Loading…</p> : sessions.length === 0 ? (
            <div className="ma-empty">No meetings yet. Add your first one on the right.</div>
          ) : (
            <ul className="ma-list">
              {sessions.map((s) => (
                <li key={s.id} className="ma-row" aria-current={s.id === selectedId}>
                  <button className="ma-row-title" onClick={() => setSelectedId(s.id)}>{s.title}</button>
                  <div className="ma2-row-line">
                    <StatusChip status={s.status} />
                    {s.simulated && <span className="ma-chip ma-sim">Simulated</span>}
                  </div>
                  <div className="ma-meta">
                    {providerName(s.provider)} · {s.scheduledFor ? `Scheduled ${fmt(s.scheduledFor)}` : `Added ${fmt(s.createdAt)}`}
                  </div>
                  {(canCancelSession(s) || canRetrySession(s)) && (
                    <div className="ma-actions">
                      {canRetrySession(s) && (
                        <button className="ma-btn primary ma2-sm" onClick={async () => {
                          try { await retryMeetingSession(s.id); await refresh(); }
                          catch (e) { toast(apiErrorMessage(e, "Couldn't retry."), "error"); }
                        }}>Retry</button>)}
                      {canCancelSession(s) && (
                        <button className="ma-btn danger ma2-sm" onClick={async () => {
                          try { await cancelMeetingSession(s.id); await refresh(); }
                          catch (e) { toast(apiErrorMessage(e, "Couldn't cancel."), "error"); }
                        }}>Cancel</button>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ma2-main">
          {selected ? (
            <SessionDetail session={selected} members={members} projects={projects} isAdmin={admin}
              devEnabled={!!caps?.devFixturesEnabled} googleConnected={googleConnected}
              aiReady={!!caps?.aiReady} aiReason={caps?.aiReason} recordingCaps={caps?.recording} firefliesCaps={caps?.fireflies}
              onChanged={refresh} onClose={() => setSelectedId(null)} />
          ) : (
            <>
              <section className="ma2-start" aria-labelledby="ma2-start-title">
                <h2 id="ma2-start-title">Add a meeting</h2>
                <p className="ma2-start-sub">How do you want to bring it in?</p>
                <div className="ma2-ways" role="group" aria-label="Ways to add a meeting">
                  {ways.map((w) => (
                    <button key={w.id} type="button" className="ma2-way" aria-pressed={way === w.id} onClick={() => setWay(w.id)}>
                      <span className="ma2-way-icon" aria-hidden="true"><w.icon size={18} /></span>
                      <span className="ma2-way-text">
                        <span className="ma2-way-title">{w.title}{w.recommended && <span className="ma2-badge">Recommended</span>}</span>
                        <span className="ma2-way-desc">{w.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {way === "upload" && (
                <UploadTranscriptPanel projects={projects} aiReady={!!caps?.aiReady} aiReason={caps?.aiReason}
                  autoCreate={!!(caps?.autoCreateTasks || caps?.autoCreateProjects)} limits={caps?.transcriptUpload}
                  initialProjectId={projectId} onCreated={openCreated} />
              )}
              {way === "record" && recordingReady && <RecordMeetingPanel recording={caps.recording} onCreated={openCreated} />}
              {way === "fireflies" && firefliesReady && <FirefliesPanel onCreated={openCreated} />}
              {way === "link" && registerForm}

              {admin && caps && (
                <details className="ma2-fold ma2-admin">
                  <summary>Assistant settings (admins)</summary>
                  <div className="ma2-fold-body">
                    <RecordingSettingsCard recording={caps.recording} onChanged={reloadCaps} />
                    <FirefliesSettingsCard fireflies={caps.fireflies} onChanged={reloadCaps} />
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
