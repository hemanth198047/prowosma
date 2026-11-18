import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CalendarPlus, Check, CheckCircle2, Circle, Download, FileText, Link2, Loader2, MessageSquare,
  Plug, Plus, RefreshCw, Send, Settings, Sparkles, Upload, Video, X,
} from "lucide-react";
import ActionMenu from "../components/ui/ActionMenu";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { getTeamMembers } from "../api/team";
import { getProjects } from "../api/projects";
import {
  getUmaDashboard, getUmaMeeting, getUmaProviders, detectUmaLink, uploadUmaRecording, addUmaRecording,
  importUmaTranscriptText, importUmaTranscriptFile, registerUmaLink, retryUmaMeeting, regenerateUmaMeeting,
  cancelUmaMeeting, completeUmaMeeting, deleteUmaMeeting, shareUmaMeeting, editUmaSegment, editUmaAction,
  approveUmaAction, rejectUmaAction, approveUmaActions, askUma, exportUma,
  getUmaFirefliesRecent, importUmaFireflies, getUmaFireflies, sendUmaNotetaker, fetchUmaGoogle,
  getUmaGoogle, scheduleUmaMeeting, setUmaAutoFireflies, checkUmaMeeting, startUmaInstantMeeting,
  getUmaMicrosoft, getUmaAutomationSettings, saveUmaWorkspaceAutomation, saveUmaMyPreferences, decideUmaProject,
} from "../api/aiMeetingAssistant";
import AiMeetingRecorder from "../components/AiMeetingRecorder";
import AiMeetingConnections from "../components/AiMeetingConnections";
import "../styles/pages/ai-meeting-assistant.css";

/* ── small helpers ─────────────────────────────────────────────────────── */

// Lists come back as an array, a page ({ content }) or wrapped ({ data }) depending on the endpoint.
const list = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.data || r?.data?.content || r?.data?.items || []);
const OPEN_PROJECT = (p) => !p.archived && !["DONE", "COMPLETED", "CANCELLED", "CLOSED", "ARCHIVED"].includes(String(p.status || "").toUpperCase());
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) : "");
const clock = (ms) => {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const minutes = (ms) => (ms ? `${Math.max(1, Math.round(ms / 60000))} min` : "");
const WORKING = new Set(["QUEUED", "TRANSCRIBING", "ANALYZING"]);
const TONE = {
  CREATED: "neutral", CAPTURING: "info", QUEUED: "info", TRANSCRIBING: "info", ANALYZING: "info",
  REVIEW_READY: "attention", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral",
};
const SOURCE = { FIREFLIES_IMPORT: "Fireflies", RECORDING_UPLOAD: "Recording", TRANSCRIPT_IMPORT: "Transcript", MEETING_LINK: "Meeting link", BROWSER_CAPTURE: "Browser capture" };
const STATE_TEXT = {
  VERIFIED: "Works — tested", IMPLEMENTED: "Built in", POSSIBLE: "Possible later (needs setup)", UNAVAILABLE: "Not available",
};
const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.mp4,.webm,.ogg,.oga,.opus,.aac,.flac,.mov,.mkv,.mpeg,.mpga,audio/*,video/*";
const TRANSCRIPT_ACCEPT = ".vtt,.srt,.txt,.docx,.json,text/plain,text/vtt";

function Pill({ status, label }) {
  const tone = ["Waiting for transcript", "Scheduled", "In progress", "Getting transcript"].includes(label) ? "info" : TONE[status] || "neutral";
  return <span className={`uma-pill uma-pill--${tone}`}><span className="uma-dot" aria-hidden="true" />{label || status}</span>;
}

function Refs({ evidence, onOpen }) {
  if (!evidence?.length) return null;
  return (
    <span className="uma-refs">
      {evidence.map((n) => (
        <button key={n} type="button" className="uma-ref" onClick={() => onOpen?.(n)} title={`Show transcript line ${n}`}
          aria-label={`Show transcript line ${n}`}>#{n}</button>
      ))}
    </span>
  );
}

const fileBase = (title) => (title || "meeting").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "meeting";

async function saveBlob(res, fallbackName) {
  // The server's filename header isn't readable from another origin, so the page names the file itself.
  const cd = res.headers?.["content-disposition"] || "";
  const name = /filename="?([^";]+)"?/i.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── dialogs ───────────────────────────────────────────────────────────── */

function Dialog({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector("input, textarea, select, button")?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="uma-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`uma-dialog${wide ? " uma-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="uma-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="uma-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const nowLocal = () => {
  const d = new Date(); d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Where this meeting's agreed tasks go. Chosen: every task goes into that project. Left on "Decide from the meeting": the project the
 * meeting names (an existing one is linked) or explicitly asks to create; if neither, the tasks are created without a project.
 */
function ProjectPicker({ projectId, setProjectId, projects }) {
  const open = projects.filter(OPEN_PROJECT).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const chosen = open.find((p) => p.id === projectId);
  return (
    <label className="uma-field"><span>Project for the tasks</span>
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">Decide from the meeting</option>
        {open.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <small className="uma-fine">
        {chosen ? `Tasks agreed in this meeting go into "${chosen.name}".`
          : open.length ? "Tasks go into the project the meeting names or asks to create; otherwise they're created without a project. Pick one to put them all there."
            : "No open projects yet. Tasks go into a project the meeting asks to create, or are created without one."}
      </small>
    </label>
  );
}

function CommonFields({ title, setTitle, at, setAt, projectId, setProjectId, projects, titlePlaceholder }) {
  return (
    <>
      <label className="uma-field"><span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder} maxLength={200} />
      </label>
      <div className="uma-row2">
        <label className="uma-field"><span>When it happened</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <ProjectPicker projectId={projectId} setProjectId={setProjectId} projects={projects} />
      </div>
    </>
  );
}

function UploadDialog({ onClose, onDone, projects, readiness, existingId }) {
  const { show: toast } = useToast();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(nowLocal());
  const [projectId, setProjectId] = useState("");
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const busy = progress !== null;
  const maxMb = readiness?.maxUploadMb || 500;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!file) return setError("Choose a recording.");
    if (file.size > maxMb * 1024 * 1024) return setError(`That recording is larger than ${maxMb} MB. Export only the audio, or split it.`);
    if (!consent) return setError("Please confirm that everyone knew the meeting was recorded.");
    setProgress(0);
    try {
      const r = existingId
        ? await addUmaRecording(existingId, file, true, setProgress)
        : await uploadUmaRecording(file, {
          title: title.trim() || undefined, projectId: projectId || undefined,
          meetingAt: at ? new Date(at).toISOString() : undefined, timezone: tz(), consent: true,
        }, setProgress);
      toast("Uploaded. We'll let you know when the summary is ready.", "success");
      onDone(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The upload didn't finish. Check your connection and try again."));
      setProgress(null);
    }
  };

  return (
    <Dialog title={existingId ? "Add the recording" : "Upload a recording"} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="uma-form">
        {readiness && !readiness.transcriptionReady && (
          <p className="uma-note uma-note--warn" role="status"><AlertTriangle size={14} aria-hidden="true" /> {readiness.transcriptionReason} You can still upload; it will be transcribed once that is set up.</p>
        )}
        <label className="uma-drop">
          <input type="file" accept={AUDIO_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
          <Upload size={18} aria-hidden="true" />
          <span>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "Choose an audio or video file"}</span>
          <small>MP3, M4A, WAV, MP4, WebM, OGG, FLAC or MOV, up to {maxMb} MB. Audio only is enough.</small>
        </label>
        {!existingId && (
          <CommonFields title={title} setTitle={setTitle} at={at} setAt={setAt} projectId={projectId} setProjectId={setProjectId}
            projects={projects} titlePlaceholder={file ? file.name.replace(/\.[^.]+$/, "") : "e.g. Weekly launch sync"} />
        )}
        <label className="uma-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
          <span>Everyone in this meeting knew it was being recorded and transcribed.</span>
        </label>
        <p className="uma-fine">The recording is sent to your workspace's speech-to-text server, and the transcript to your AI model.
          The recording file is deleted after it has been transcribed.</p>
        {error && <p className="uma-error" role="alert">{error}</p>}
        {busy && (
          <div className="uma-progress" role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <span style={{ width: `${progress ?? 5}%` }} />
          </div>
        )}
        <div className="uma-dialog-actions">
          <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary pg-btn" disabled={busy}>
            {busy ? <><Loader2 size={14} className="uma-spin" aria-hidden="true" />Uploading {progress != null ? `${progress}%` : ""}</> : <><Upload size={14} aria-hidden="true" />Upload</>}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ onClose, onDone, projects }) {
  const { show: toast } = useToast();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(nowLocal());
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!file && !text.trim()) return setError("Paste the transcript or choose a file.");
    if (file && file.size > 1024 * 1024) return setError("Transcript files up to 1 MB can be imported here. Paste the text instead.");
    setBusy(true);
    const meta = { title: title.trim() || undefined, projectId: projectId || undefined, meetingAt: at ? new Date(at).toISOString() : undefined, timezone: tz() };
    try {
      const r = file ? await importUmaTranscriptFile(file, meta) : await importUmaTranscriptText({ ...meta, text });
      toast("Imported. Writing the summary now.", "success");
      onDone(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The transcript couldn't be imported."));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Import a transcript" onClose={onClose} wide>
      <form onSubmit={submit} className="uma-form">
        <p className="uma-hint">From Zoom, Teams, Google Meet, Webex or any notetaker: a .vtt, .srt, .txt or .docx file, or pasted text.
          Speaker names are kept when the file has them.</p>
        <label className="uma-field"><span>Transcript file</span>
          <input type="file" accept={TRANSCRIPT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {!file && (
          <label className="uma-field"><span>…or paste it</span>
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Alex: Let's start with the launch.\nRavi: I'll finish the API by Friday."} />
          </label>
        )}
        <CommonFields title={title} setTitle={setTitle} at={at} setAt={setAt} projectId={projectId} setProjectId={setProjectId}
          projects={projects} titlePlaceholder="e.g. Weekly launch sync" />
        {error && <p className="uma-error" role="alert">{error}</p>}
        <div className="uma-dialog-actions">
          <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary pg-btn" disabled={busy}>
            {busy ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}Import
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LinkDialog({ onClose, onDone, projects }) {
  const { show: toast } = useToast();
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(nowLocal());
  const [minutes, setMinutes] = useState(60);
  const [projectId, setProjectId] = useState("");
  const [autoFf, setAutoFf] = useState(true);
  const [ff, setFf] = useState(null);
  const [google, setGoogle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getUmaFireflies().then((r) => setFf(r.data)).catch(() => setFf({ connected: false }));
    getUmaGoogle().then((r) => setGoogle(r.data)).catch(() => setGoogle({ connected: false }));
  }, []);
  useEffect(() => {
    const u = url.trim();
    if (!/^https:\/\/\S+\.\S+/.test(u)) return undefined;
    const t = setTimeout(() => detectUmaLink(u).then((r) => setDetected(r.data)).catch(() => setDetected(null)), 350);
    return () => clearTimeout(t);
  }, [url]);

  const [openedAt] = useState(() => Date.now());
  const future = at && new Date(at).getTime() > openedAt - 5 * 60000;
  const isMeet = detected?.provider === "GOOGLE_MEET";
  const firefliesCan = !!ff?.connected && detected && detected.provider !== "OTHER";
  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await registerUmaLink({ url: url.trim(), title: title.trim() || undefined, projectId: projectId || undefined,
        meetingAt: at ? new Date(at).toISOString() : undefined, timezone: tz(), durationMinutes: Number(minutes) || undefined,
        autoFireflies: firefliesCan && future && autoFf });
      toast("Meeting added.", "success");
      onDone(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, "That link couldn't be added."));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add a meeting link" onClose={onClose}>
      <form onSubmit={submit} className="uma-form">
        <label className="uma-field"><span>Meeting link</span>
          <input value={url} onChange={(e) => { setUrl(e.target.value); setDetected(null); }} placeholder="https://zoom.us/j/… or a Meet, Teams or Webex link" inputMode="url" required />
        </label>
        {detected && (
          <div className="uma-note" role="status">
            <div>
              <strong>{detected.name} link.</strong> How this meeting gets captured:
              <ul className="uma-howlist">
                {firefliesCan ? <li>Fireflies' notetaker can join it {future ? "automatically when it starts" : "now, while it's running"}.</li>
                  : detected.provider !== "OTHER" && <li>Fireflies' notetaker can join it once an admin connects Fireflies (Connections).</li>}
                {isMeet && (google?.connected ? <li>Google Meet's own transcript is read after it ends (if transcription is turned on in the meeting).</li>
                  : <li>Connect your Google account (Connections) to have Google Meet's transcript read after it ends.</li>)}
                <li>Or record it from this browser, or upload the recording or transcript afterwards.</li>
              </ul>
            </div>
          </div>
        )}
        <CommonFields title={title} setTitle={setTitle} at={at} setAt={setAt} projectId={projectId} setProjectId={setProjectId}
          projects={projects} titlePlaceholder={detected ? `${detected.name} meeting` : "e.g. Weekly launch sync"} />
        <label className="uma-field"><span>Length</span>
          <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
          </select>
        </label>
        {firefliesCan && future && (
          <label className="uma-check">
            <input type="checkbox" checked={autoFf} onChange={(e) => setAutoFf(e.target.checked)} />
            <span>Send the Fireflies notetaker automatically when the meeting starts</span>
          </label>
        )}
        {error && <p className="uma-error" role="alert">{error}</p>}
        <div className="uma-dialog-actions">
          <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary pg-btn" disabled={busy || !url.trim()}><Link2 size={14} aria-hidden="true" />Add meeting</button>
        </div>
      </form>
    </Dialog>
  );
}

const PLATFORM_NAME = { GOOGLE_MEET: "Google Meet", MS_TEAMS: "Microsoft Teams" };
const CALENDAR_NAME = { GOOGLE_MEET: "Google Calendar", MS_TEAMS: "Outlook" };

/** Google and Microsoft connections, Fireflies, and the person's default platform - what the meeting dialogs need. */
function usePlatforms() {
  const [s, setS] = useState({ loaded: false, google: null, microsoft: null, ff: null, platform: "GOOGLE_MEET" });
  useEffect(() => {
    let live = true;
    Promise.all([
      getUmaGoogle().then((r) => r.data).catch(() => ({ connected: false })),
      getUmaMicrosoft().then((r) => r.data).catch(() => ({ connected: false, configured: false })),
      getUmaFireflies().then((r) => r.data).catch(() => ({ connected: false })),
      getUmaAutomationSettings().then((r) => r.data?.mine?.defaultPlatform).catch(() => null),
    ]).then(([google, microsoft, ff, preferred]) => {
      if (!live) return;
      // The person's default, unless only the other one is connected.
      let platform = preferred || "GOOGLE_MEET";
      const ok = (p) => (p === "MS_TEAMS" ? microsoft?.connected && microsoft?.canSchedule : google?.connected && google?.calendar);
      if (!ok(platform) && ok(platform === "MS_TEAMS" ? "GOOGLE_MEET" : "MS_TEAMS")) platform = platform === "MS_TEAMS" ? "GOOGLE_MEET" : "MS_TEAMS";
      setS({ loaded: true, google, microsoft, ff, platform });
    });
    return () => { live = false; };
  }, []);
  const setPlatform = (platform) => setS((x) => ({ ...x, platform }));
  const ready = s.platform === "MS_TEAMS" ? !!(s.microsoft?.connected && s.microsoft?.canSchedule) : !!(s.google?.connected && s.google?.calendar);
  const account = s.platform === "MS_TEAMS" ? s.microsoft?.account : s.google?.account;
  const whyNot = s.platform === "MS_TEAMS"
    ? (s.microsoft?.configured === false ? "Microsoft Teams isn't set up on the server yet. An admin adds the Microsoft app (see the setup guide)."
      : "Connect your Microsoft 365 account first (Connections). The meeting is created in your Outlook calendar with a Teams link, and Microsoft sends the invitations.")
    : (s.google?.connected && !s.google?.calendar ? "Your Google account is connected without Calendar access. Connect it again from Connections and allow Calendar."
      : "Connect your Google account first (Connections). The meeting is created in your Google Calendar with a Meet link, and Google sends the invitations.");
  return { ...s, setPlatform, ready, account, whyNot };
}

function PlatformPicker({ value, onChange, disabled }) {
  return (
    <div className="pg-seg uma-platforms" role="group" aria-label="Meeting app">
      {["GOOGLE_MEET", "MS_TEAMS"].map((p) => (
        <button key={p} type="button" aria-pressed={value === p} disabled={disabled} onClick={() => onChange(p)}>{PLATFORM_NAME[p]}</button>
      ))}
    </div>
  );
}

function ScheduleDialog({ onClose, onDone, projects, openConnections }) {
  const { show: toast } = useToast();
  const pf = usePlatforms();
  const ff = pf.ff;
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60000); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [minutes, setMinutes] = useState(30);
  const [people, setPeople] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [autoFf, setAutoFf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("Give the meeting a title.");
    setBusy(true);
    try {
      const attendees = people.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const r = await scheduleUmaMeeting({ title: title.trim(), start: new Date(at).toISOString(), durationMinutes: Number(minutes), timezone: tz(),
        attendees, description: description.trim() || undefined, projectId: projectId || undefined, autoFireflies: !!ff?.connected && autoFf, platform: pf.platform });
      const cal = CALENDAR_NAME[pf.platform];
      toast(attendees.length ? `Meeting created in ${cal} and ${attendees.length} invitation${attendees.length === 1 ? "" : "s"} sent.` : `Meeting created in ${cal}.`, "success");
      onDone(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The meeting couldn't be created."));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Schedule a meeting" onClose={busy ? () => {} : onClose} wide>
      {pf.loaded && <PlatformPicker value={pf.platform} onChange={pf.setPlatform} disabled={busy} />}
      {!pf.loaded ? <p className="uma-hint"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Checking your connections…</p> : !pf.ready ? (
        <div className="uma-form">
          <p className="uma-note uma-note--warn">{pf.whyNot}</p>
          <div className="uma-dialog-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary pg-btn" onClick={openConnections}><Plug size={14} aria-hidden="true" />Open Connections</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="uma-form">
          <p className="uma-hint">Created in {pf.account}'s {CALENDAR_NAME[pf.platform]} with a {PLATFORM_NAME[pf.platform]} link. {pf.platform === "MS_TEAMS" ? "Microsoft" : "Google"} emails the invitations.</p>
          <label className="uma-field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website relaunch – weekly sync" maxLength={200} required />
          </label>
          <div className="uma-row2">
            <label className="uma-field"><span>Starts</span>
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
            </label>
            <label className="uma-field"><span>Length</span>
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
              </select>
            </label>
          </div>
          <label className="uma-field"><span>Invite <em>(email addresses, separated by commas or spaces)</em></span>
            <textarea rows={2} value={people} onChange={(e) => setPeople(e.target.value)} placeholder="priya@company.com, ravi@company.com" />
          </label>
          <label className="uma-field"><span>Agenda <em>(optional, goes into the invitation)</em></span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <ProjectPicker projectId={projectId} setProjectId={setProjectId} projects={projects} />
          {ff?.connected ? (
            <label className="uma-check">
              <input type="checkbox" checked={autoFf} onChange={(e) => setAutoFf(e.target.checked)} />
              <span>Send the Fireflies notetaker when it starts (someone in the meeting may need to admit it)</span>
            </label>
          ) : <p className="uma-fine">Connect Fireflies (Connections) to have its notetaker join automatically.</p>}
          <p className="uma-fine">After the meeting the transcript is fetched by itself ({PLATFORM_NAME[pf.platform]} transcription must be on), the notes are written and clearly agreed tasks are created.</p>
          {error && <p className="uma-error" role="alert">{error}</p>}
          <div className="uma-dialog-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary pg-btn" disabled={busy}>
              {busy ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : <CalendarPlus size={14} aria-hidden="true" />}Create meeting
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function InstantDialog({ onClose, onDone, projects, openConnections }) {
  const { show: toast } = useToast();
  const pf = usePlatforms();
  const ff = pf.ff;
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [people, setPeople] = useState("");
  const [projectId, setProjectId] = useState("");
  const [autoFf, setAutoFf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);       // shown when the browser blocked the new tab
  const start = async (e) => {
    e.preventDefault();
    setError("");
    // Open the tab now, while the click still counts as the person's action - browsers block tabs opened later.
    const tab = window.open("", "_blank");
    if (tab) tab.document.write("<p style='font-family:sans-serif;padding:24px'>Creating your meeting…</p>");
    setBusy(true);
    try {
      const attendees = people.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const r = await startUmaInstantMeeting({ title: title.trim() || undefined, durationMinutes: Number(minutes), timezone: tz(),
        attendees, projectId: projectId || undefined, autoFireflies: !!ff?.connected && autoFf, platform: pf.platform });
      const url = r.data.meetingUrl;
      if (tab && !tab.closed) { tab.location.href = url; toast("Your meeting is open in a new tab.", "success"); onDone(r.data); }
      else { setCreated(r.data); setBusy(false); }
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      setError(apiErrorMessage(err, "The meeting couldn't be started."));
      setBusy(false);
    }
  };
  if (created) return (
    <Dialog title="Your meeting is ready" onClose={() => onDone(created)}>
      <div className="uma-form">
        <p className="uma-hint">The browser didn't let us open a new tab. Join from here:</p>
        <a className="btn-primary pg-btn" href={created.meetingUrl} target="_blank" rel="noreferrer noopener" onClick={() => onDone(created)}>
          <Video size={15} aria-hidden="true" />Join the meeting</a>
      </div>
    </Dialog>
  );
  return (
    <Dialog title="Start a meeting now" onClose={busy ? () => {} : onClose}>
      {pf.loaded && <PlatformPicker value={pf.platform} onChange={pf.setPlatform} disabled={busy} />}
      {!pf.loaded ? <p className="uma-hint"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Checking your connections…</p> : !pf.ready ? (
        <div className="uma-form">
          <p className="uma-note uma-note--warn">{pf.whyNot}</p>
          <div className="uma-dialog-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary pg-btn" onClick={openConnections}><Plug size={14} aria-hidden="true" />Open Connections</button>
          </div>
        </div>
      ) : (
        <form onSubmit={start} className="uma-form">
          <p className="uma-hint">A {PLATFORM_NAME[pf.platform]} meeting starting now, in {pf.account}'s calendar. It opens in a new tab.</p>
          <label className="uma-field"><span>Title <em>(optional)</em></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Instant meeting" maxLength={200} />
          </label>
          <div className="uma-row2">
            <label className="uma-field"><span>Invite <em>(optional)</em></span>
              <input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="priya@company.com, ravi@company.com" />
            </label>
            <label className="uma-field"><span>About how long</span>
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}</option>)}
              </select>
            </label>
          </div>
          <ProjectPicker projectId={projectId} setProjectId={setProjectId} projects={projects} />
          {ff?.connected ? (
            <label className="uma-check">
              <input type="checkbox" checked={autoFf} onChange={(e) => setAutoFf(e.target.checked)} />
              <span>Bring the Fireflies notetaker (it asks to join about a minute after you start - admit it)</span>
            </label>
          ) : <p className="uma-fine">Connect Fireflies (Connections) to have its notetaker join, or use Record meeting to record this tab.</p>}
          {error && <p className="uma-error" role="alert">{error}</p>}
          <div className="uma-dialog-actions">
            <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary pg-btn" disabled={busy}>
              {busy ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}Start meeting
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Kept short on purpose: people choose their meeting app and whether tasks are created for them; admins set the workspace's rules. */
function SettingsDialog({ onClose }) {
  const { show: toast } = useToast();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { getUmaAutomationSettings().then((r) => setS(r.data)).catch((e) => setError(apiErrorMessage(e, "Settings couldn't be loaded."))); }, []);
  const save = async (fn, ok) => {
    setBusy(true); setError("");
    try { const r = await fn(); setS(r.data); toast(ok, "success"); }
    catch (e) { setError(apiErrorMessage(e, "That couldn't be saved.")); }
    finally { setBusy(false); }
  };
  const mine = s?.mine, ws = s?.workspace;
  return (
    <Dialog title="Settings" onClose={busy ? () => {} : onClose}>
      {!s ? (error ? <p className="uma-error" role="alert">{error}</p> : <p className="uma-hint"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Loading…</p>) : (
        <div className="uma-form">
          <h3 className="uma-h3">For you</h3>
          <div className="uma-field"><span>Meeting app for new meetings</span>
            <PlatformPicker value={mine.defaultPlatform} disabled={busy} onChange={(p) => save(() => saveUmaMyPreferences({ defaultPlatform: p }), `New meetings use ${PLATFORM_NAME[p]}.`)} />
          </div>
          <label className="uma-check">
            <input type="checkbox" checked={mine.autoTasks} disabled={busy} onChange={(e) => save(() => saveUmaMyPreferences({ autoTasks: e.target.checked }), e.target.checked ? "Tasks will be created automatically from your meetings." : "Your meetings' tasks will wait for you to create them.")} />
            <span>Create clearly agreed tasks from my meetings automatically</span>
          </label>
          <p className="uma-fine">Notes are always written automatically when the transcript arrives. Anything unclear - an owner who wasn't invited, a suggestion rather than an agreement - waits for you on the meeting page.</p>
          <h3 className="uma-h3">For the whole workspace{s.canChangeWorkspace ? "" : " (set by an admin)"}</h3>
          {[
            ["autoCreateTasks", "Create clearly agreed tasks automatically"],
            ["autoAssign", "Assign them when the owner was invited to the meeting"],
            ["autoCreateProjects", "Create a project when someone clearly asks for one by name"],
          ].map(([k, label]) => (
            <label key={k} className="uma-check">
              <input type="checkbox" checked={!!ws[k]} disabled={busy || !s.canChangeWorkspace}
                onChange={(e) => save(() => saveUmaWorkspaceAutomation({ [k]: e.target.checked }), "Saved for the workspace.")} />
              <span>{label}</span>
            </label>
          ))}
          <p className="uma-fine">At most {ws.maxAutoTasksPerMeeting} tasks are created automatically per meeting. Nothing is ever changed or deleted automatically - only created.</p>
          {error && <p className="uma-error" role="alert">{error}</p>}
          <div className="uma-dialog-actions"><button type="button" className="btn-primary pg-btn" onClick={onClose} disabled={busy}>Done</button></div>
        </div>
      )}
    </Dialog>
  );
}

function FirefliesImportDialog({ onClose, onDone, projects }) {
  const { show: toast } = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [projectId, setProjectId] = useState("");
  useEffect(() => {
    getUmaFirefliesRecent().then((r) => setItems(r.data)).catch((e) => { setItems([]); setError(apiErrorMessage(e, "Fireflies couldn't be reached.")); });
  }, []);
  const pick = async (id) => {
    setBusy(id); setError("");
    try { const r = await importUmaFireflies(id, projectId || undefined); toast("Imported from Fireflies. Writing the summary now.", "success"); onDone(r.data); }
    catch (e) { setError(apiErrorMessage(e, "That meeting couldn't be imported.")); setBusy(""); }
  };
  return (
    <Dialog title="Import from Fireflies" onClose={onClose} wide>
      <div className="uma-form">
        <p className="uma-hint">Your most recent Fireflies meetings. Each can be imported once.</p>
        {items === null ? <p className="uma-hint"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Asking Fireflies…</p>
          : items.length === 0 && !error ? <p className="uma-hint">No Fireflies meetings found for this account.</p> : (
            <ul className="uma-fflist">
              {items.map((x) => (
                <li key={x.id}>
                  <div><strong>{x.title || "Untitled meeting"}</strong><span className="uma-fine">{when(x.date)}{x.live ? " · still running" : ""}</span></div>
                  {x.imported ? <span className="uma-fine">Imported</span> : (
                    <button type="button" className="btn-secondary pg-btn" disabled={!!busy || x.live} onClick={() => pick(x.id)}>
                      {busy === x.id ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : null}Import
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        <ProjectPicker projectId={projectId} setProjectId={setProjectId} projects={projects} />
        {error && <p className="uma-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ── dashboard ─────────────────────────────────────────────────────────── */

function MeetingRow({ m }) {
  return (
    <li className="uma-mrow">
      <Link to={`/ai-meeting-assistant/${m.id}`} className="uma-mrow-title">{m.title}</Link>
      <span className="uma-mrow-meta">
        {SOURCE[m.source] || m.source}{m.meetingAt ? ` · ${when(m.meetingAt)}` : ""}{m.durationMs ? ` · ${minutes(m.durationMs)}` : ""}
      </span>
      <span className="uma-mrow-status">
        <Pill status={m.status} label={m.statusLabel} />
        {WORKING.has(m.status) && m.progressPercent != null && <span className="uma-mrow-pct">{m.progressPercent}%</span>}
      </span>
    </li>
  );
}

function Section({ title, items, empty }) {
  if (!items?.length && !empty) return null;
  return (
    <section className="uma-section" aria-label={title}>
      <h2 className="pg-section-title">{title} {items?.length ? <span className="uma-count">{items.length}</span> : null}</h2>
      {items?.length ? <ul className="uma-mlist">{items.map((m) => <MeetingRow key={m.id} m={m} />)}</ul> : <p className="uma-hint">{empty}</p>}
    </section>
  );
}

function ProviderCards() {
  const [providers, setProviders] = useState(null);
  useEffect(() => { getUmaProviders().then((r) => setProviders(r.data)).catch(() => setProviders([])); }, []);
  if (!providers?.length) return null;
  return (
    <details className="uma-providers">
      <summary>What works with each meeting app</summary>
      <p className="uma-hint">Shown as it really is today. "Possible later" needs an admin connection and the meeting app's permission.</p>
      <div className="uma-pgrid">
        {providers.filter((p) => p.id !== "OTHER").map((p) => (
          <div key={p.id} className="uma-pcard">
            <h3>{p.name}</h3>
            <ul>
              {p.capabilities.map((c) => {
                const ok = c.state === "VERIFIED" || c.state === "IMPLEMENTED";
                return (
                  <li key={c.key} className={ok ? "ok" : c.state === "UNAVAILABLE" ? "no" : "later"} title={c.note || ""}>
                    {ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    <span>{c.label}</span><em>{STATE_TEXT[c.state] || c.state}{c.state !== "VERIFIED" && c.note ? ` — ${c.note}` : ""}</em>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("uma.howItWorks") !== "closed"; } catch { return true; } });
  const toggle = (e) => {
    const isOpen = e.currentTarget.open;
    setOpen(isOpen);
    try { localStorage.setItem("uma.howItWorks", isOpen ? "open" : "closed"); } catch { /* private window */ }
  };
  return (
    <details className="uma-how" open={open} onToggle={toggle}>
      <summary>How it works</summary>
      <ol className="uma-how-steps">
        <li><strong>Start or plan the meeting.</strong> Click <em>Meet now</em> for a meeting right away, or <em>Add → Schedule a meeting</em> for later -
          in Google Meet or Microsoft Teams (choose your usual one in <em>Settings</em>). Invite the people who'll be there.</li>
        <li><strong>Join it from Prowosma</strong> with <em>Join meeting</em>, and turn on the meeting's transcription (or let Fireflies' notetaker join - admit it when it asks).</li>
        <li><strong>Talk as usual.</strong> Say clearly who does what and by when ("Priya, can you do the frontend by Thursday?" - "Yes").</li>
        <li><strong>That's it.</strong> A few minutes after the meeting the notes are written and clearly agreed tasks are created and assigned to the
          people who were invited. You'll see <em>Meeting processed: 3 tasks created…</em></li>
        <li><strong>Check anything that needs you.</strong> Items that weren't clear (an owner who wasn't invited, a suggestion rather than an agreement)
          wait on the meeting page with the reason - create, change or dismiss them.</li>
      </ol>
      <p className="uma-fine">No Fireflies? Click <em>Record meeting</em> before you start and share the meeting tab (Chrome or Edge).
        Already have a recording or a transcript? Use <em>Upload recording</em> or <em>Add → Import transcript</em>.</p>
    </details>
  );
}

function Dashboard({ openDialog }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => getUmaDashboard().then((r) => { setData(r.data); setError(""); })
    .catch((e) => setError(apiErrorMessage(e, "The meeting list couldn't be loaded."))), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.inProgress?.length) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data, load]);
  useEffect(() => {
    window.addEventListener("uma:changed", load);
    return () => window.removeEventListener("uma:changed", load);
  }, [load]);

  if (error) return <div className="pg-empty"><h2>Not available</h2><p>{error}</p></div>;
  if (!data) return <p className="uma-hint" role="status"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Loading…</p>;
  const r = data.readiness || {};
  const nothing = !data.recent?.length && !data.upcoming?.length;
  return (
    <>
      {(!r.transcriptionReady || !r.aiReady) && (
        <div className="uma-note uma-note--warn" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <strong>Setup needed before meetings can be processed.</strong>
            {!r.transcriptionReady && <p>{r.transcriptionReason}</p>}
            {!r.aiReady && <p>{r.aiReason}</p>}
            {r.aiReady && !r.transcriptionReady && <p>Imported transcripts work already.</p>}
          </div>
        </div>
      )}

      <HowItWorks />

      <div className="uma-stats">
        <div className="pg-stat"><span className="pg-stat-num">{data.inProgress.length}</span><span className="pg-stat-label">Processing</span></div>
        <div className="pg-stat"><span className="pg-stat-num">{data.awaitingReview.length}</span><span className="pg-stat-label">Ready for review</span></div>
        <div className="pg-stat"><span className="pg-stat-num">{data.pendingActions.length}</span><span className="pg-stat-label">Action items to review</span></div>
        <div className={`pg-stat${data.failed.length ? " pg-stat--late" : ""}`}><span className="pg-stat-num">{data.failed.length}</span><span className="pg-stat-label">Need attention</span></div>
      </div>

      {nothing ? (
        <div className="pg-empty uma-empty">
          <Sparkles size={28} aria-hidden="true" />
          <h2>Turn a meeting into notes and tasks</h2>
          <p>Record a meeting in this browser, upload a recording, or import a transcript. You'll get a summary, the decisions, and action items to approve as tasks.</p>
          {data.canCreate && (
            <div className="uma-empty-actions">
              <button type="button" className="btn-primary pg-btn" onClick={() => openDialog("record")}><Circle size={13} fill="currentColor" aria-hidden="true" />Record meeting</button>
              <button type="button" className="btn-secondary pg-btn" onClick={() => openDialog("upload")}><Upload size={15} aria-hidden="true" />Upload recording</button>
              <button type="button" className="btn-secondary pg-btn" onClick={() => openDialog("import")}><FileText size={15} aria-hidden="true" />Import transcript</button>
            </div>
          )}
        </div>
      ) : (
        <div className="uma-columns">
          <div>
            <Section title="Needs attention" items={data.failed} />
            <Section title="Ready for review" items={data.awaitingReview} />
            <Section title="Processing" items={data.inProgress} />
            <Section title="Upcoming" items={data.upcoming} />
            <Section title="Recent meetings" empty="No other meetings."
              items={data.recent.filter((m) => !["REVIEW_READY", "FAILED", "QUEUED", "TRANSCRIBING", "ANALYZING"].includes(m.status)
                && !data.upcoming.some((u) => u.id === m.id))} />
          </div>
          <aside className="uma-side" aria-label="Action items waiting for review">
            <h2 className="pg-section-title">Action items to review</h2>
            {data.pendingActions.length === 0 ? <p className="uma-hint">Nothing waiting.</p> : (
              <ul className="uma-plist">
                {data.pendingActions.map(({ meetingId, meetingTitle, action }) => (
                  <li key={`${meetingId}:${action.id}`}>
                    <Link to={`/ai-meeting-assistant/${meetingId}?tab=actions`}>{action.title}</Link>
                    <span>{meetingTitle}{action.ownerSpoken ? ` · ${action.ownerSpoken}` : ""}{action.dueDate ? ` · ${day(action.dueDate)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
      <ProviderCards />
    </>
  );
}

/* ── meeting detail ────────────────────────────────────────────────────── */

const TABS = [
  ["overview", "Overview"], ["summary", "Summary"], ["transcript", "Transcript"],
  ["decisions", "Decisions"], ["actions", "Action items"], ["ask", "Ask AI"],
];

/** What was done on its own after the meeting. The numbers come from saved records, not from what the AI said. */
function AutomationReport({ ins, setTab }) {
  const r = ins?.automation;
  if (!r) return null;
  const projectUpdates = (r.projectsCreated || 0) + (r.projectsLinked || 0);
  return (
    <section className="uma-report" aria-label="What was done automatically">
      <strong>Meeting processed</strong>
      <ul>
        <li><b>{r.tasksCreated}</b> task{r.tasksCreated === 1 ? "" : "s"} created</li>
        <li><b>{r.tasksAssigned}</b> assigned</li>
        <li><b>{projectUpdates}</b> project update{projectUpdates === 1 ? "" : "s"}</li>
        <li className={r.needsReview ? "uma-report-warn" : ""}>
          {r.needsReview ? <button type="button" className="uma-link" onClick={() => setTab("actions")}><b>{r.needsReview}</b> need{r.needsReview === 1 ? "s" : ""} your review</button>
            : <><b>0</b> to review</>}
        </li>
        {r.failed > 0 && <li className="uma-report-warn"><b>{r.failed}</b> couldn't be created</li>}
      </ul>
      {!r.tasksEnabled && <p className="uma-fine">Automatic task creation is off for this meeting (Settings).</p>}
      {(r.notes || []).map((n) => <p key={n} className="uma-fine">{n}</p>)}
    </section>
  );
}

const PROJECT_INTENT = { CREATE: "Asked for in the meeting", PROPOSAL: "Suggested", EXISTING: "Mentioned" };

function MeetingProjects({ d, projects, onChanged, openLine }) {
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(null);
  const [linkTo, setLinkTo] = useState({});
  const items = d.insights?.projects || [];
  if (!items.length) return null;
  const act = async (p, op) => {
    setBusy(p.id);
    try {
      await decideUmaProject(d.meeting.id, p.id, op, op === "link" ? linkTo[p.id] : undefined);
      toast(op === "create" ? `Project "${p.name}" created.` : op === "link" ? "Linked to the project." : "Dismissed.", "success");
      onChanged();
    } catch (e) { toast(apiErrorMessage(e, "That didn't work."), "error"); }
    finally { setBusy(null); }
  };
  return (
    <>
      <h3 className="uma-h3">Projects</h3>
      <ul className="uma-projects">
        {items.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong> <span className="uma-fine">· {PROJECT_INTENT[p.intent] || ""} <Refs evidence={p.evidence} onOpen={openLine} /></span>
              {p.description && <div className="uma-fine">{p.description}</div>}
              {p.status === "PROPOSED" && p.reviewReason && <div className="uma-review-why"><AlertTriangle size={13} aria-hidden="true" />{p.reviewReason}</div>}
            </div>
            {p.status === "CREATED" && <span className="uma-pill uma-pill--success"><CheckCircle2 size={12} aria-hidden="true" />{p.automatic ? "Created automatically" : "Created"}</span>}
            {p.status === "LINKED" && <span className="uma-pill uma-pill--info">Linked</span>}
            {p.status === "DISMISSED" && <span className="uma-pill uma-pill--neutral">Dismissed</span>}
            {(p.status === "CREATED" || p.status === "LINKED") && p.projectId && <Link className="uma-link" to={`/projects?highlight=${p.projectId}`}>Open project</Link>}
            {d.canManage && p.status === "PROPOSED" && (
              <span className="uma-project-actions">
                <button type="button" className="btn-primary pg-btn" disabled={busy === p.id} onClick={() => act(p, "create")}>Create project</button>
                <select aria-label={`Link "${p.name}" to an existing project`} value={linkTo[p.id] || ""} onChange={(e) => setLinkTo({ ...linkTo, [p.id]: e.target.value })}>
                  <option value="">Or link to…</option>
                  {projects.filter(OPEN_PROJECT).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                {linkTo[p.id] && <button type="button" className="btn-secondary pg-btn" disabled={busy === p.id} onClick={() => act(p, "link")}>Link</button>}
                <button type="button" className="btn-secondary pg-btn" disabled={busy === p.id} onClick={() => act(p, "dismiss")}>Dismiss</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Overview({ d, openLine, setTab, projects = [], onChanged = () => {} }) {
  const ins = d.insights;
  const m = d.meeting;
  const pending = ins?.actions?.filter((a) => a.status === "PENDING").length || 0;
  return (
    <div className="uma-overview">
      <AutomationReport ins={ins} setTab={setTab} />
      {ins?.summary && <p className="uma-summary">{ins.summary}</p>}
      <dl className="uma-facts">
        <div><dt>Decisions</dt><dd><button type="button" className="uma-link" onClick={() => setTab("decisions")}>{ins?.decisions?.length || 0}</button></dd></div>
        <div><dt>Action items</dt><dd><button type="button" className="uma-link" onClick={() => setTab("actions")}>{ins?.actions?.length || 0}{pending ? ` (${pending} to review)` : ""}</button></dd></div>
        <div><dt>Risks</dt><dd>{ins?.risks?.length || 0}</dd></div>
        <div><dt>Open questions</dt><dd>{ins?.questions?.length || 0}</dd></div>
        <div><dt>Transcript</dt><dd>{m.transcript?.segmentCount || 0} lines{m.transcript?.engine ? ` · ${m.transcript.engine}` : ""}</dd></div>
        {m.recording?.durationMs ? <div><dt>Length</dt><dd>{minutes(m.recording.durationMs)}</dd></div> : null}
        {ins?.model ? <div><dt>Written by</dt><dd>{ins.model}{ins.version > 1 ? ` · version ${ins.version}` : ""}</dd></div> : null}
      </dl>
      {ins?.decisions?.length > 0 && (
        <>
          <h3 className="uma-h3">Decisions</h3>
          <ul className="uma-items">{ins.decisions.map((x) => <li key={x.id}>{x.text} <Refs evidence={x.evidence} onOpen={openLine} /></li>)}</ul>
        </>
      )}
      <MeetingProjects d={d} projects={projects} onChanged={onChanged} openLine={openLine} />
      {ins?.warnings?.length > 0 && <p className="uma-fine">{ins.warnings.join(" ")}</p>}
      {ins?.droppedForMissingEvidence > 0 && (
        <p className="uma-fine">{ins.droppedForMissingEvidence} statement(s) from the AI were left out because they weren't backed by the transcript.</p>
      )}
    </div>
  );
}

function SummaryTab({ ins, openLine }) {
  if (!ins) return <p className="uma-hint">Not written yet.</p>;
  return (
    <div>
      <p className="uma-summary">{ins.summary}</p>
      {ins.notes?.map((t, i) => (
        <section key={i} className="uma-topic">
          <h3 className="uma-h3">{t.title}</h3>
          <ul className="uma-items">{t.points.map((p, j) => <li key={j}>{p.text} <Refs evidence={p.evidence} onOpen={openLine} /></li>)}</ul>
        </section>
      ))}
    </div>
  );
}

function FindingList({ title, items, openLine, empty }) {
  return (
    <section className="uma-topic">
      <h3 className="uma-h3">{title}</h3>
      {items?.length ? (
        <ul className="uma-items">{items.map((x) => (
          <li key={x.id}>{x.text}{x.decidedBy ? <em> — {x.decidedBy}</em> : null}{x.kind && x.kind !== "RISK" ? <em> ({x.kind.toLowerCase().replace("_", " ")})</em> : null} <Refs evidence={x.evidence} onOpen={openLine} /></li>
        ))}</ul>
      ) : <p className="uma-hint">{empty}</p>}
    </section>
  );
}

function TranscriptTab({ d, focusLine, canManage, onSaved }) {
  const { show: toast } = useToast();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const refs = useRef({});
  useEffect(() => {
    if (focusLine && refs.current[focusLine]) refs.current[focusLine].scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusLine]);
  const segs = d.segments || [];
  const shown = q.trim() ? segs.filter((s) => s.text.toLowerCase().includes(q.trim().toLowerCase())) : segs;
  const save = async (seq) => {
    try {
      await editUmaSegment(d.meeting.id, seq, { text: draft });
      setEditing(null); onSaved();
      toast("Line saved. Regenerate the summary to use the correction.", "success");
    } catch (e) { toast(apiErrorMessage(e, "The line couldn't be saved."), "error"); }
  };
  if (!segs.length) return <p className="uma-hint">No transcript yet.</p>;
  return (
    <div>
      <div className="uma-tbar">
        <label className="pg-find"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in transcript" aria-label="Find in transcript" /></label>
        <span className="uma-fine">{d.meeting.transcript?.speakersKnown ? "Speakers as named in the transcript." : "Speakers aren't identified in recordings; lines show as Unknown speaker."}</span>
      </div>
      <ol className="uma-transcript">
        {shown.map((s) => (
          <li key={s.seq} ref={(el) => { refs.current[s.seq] = el; }} className={focusLine === s.seq ? "focus" : ""} id={`line-${s.seq}`}>
            <span className="uma-ln">#{s.seq}</span>
            <span className="uma-ts">{clock(s.startMs)}</span>
            <span className="uma-who">{s.speaker || "Unknown speaker"}</span>
            {editing === s.seq ? (
              <span className="uma-edit">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} aria-label={`Edit line ${s.seq}`} />
                <button type="button" className="btn-primary pg-btn" onClick={() => save(s.seq)}>Save</button>
                <button type="button" className="btn-secondary pg-btn" onClick={() => setEditing(null)}>Cancel</button>
              </span>
            ) : (
              <span className="uma-text">{s.text}{s.edited && <em className="uma-edited"> (edited)</em>}
                {canManage && <button type="button" className="uma-edit-btn" onClick={() => { setEditing(s.seq); setDraft(s.text); }} aria-label={`Correct line ${s.seq}`}>Correct</button>}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const OWNER_TEXT = {
  MATCHED: null,
  SUGGESTED: "Probably — please confirm",
  AMBIGUOUS: "More than one person has this name",
  NOT_A_MEMBER: "Not a member of this workspace",
  UNASSIGNED: "Nobody was named",
};

function ActionCard({ a, meetingId, canManage, team, projects, selected, onSelect, openLine, onChanged }) {
  const { show: toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(a.title);   // the parent re-keys this card when the saved title changes
  const done = a.status === "CREATED" || a.status === "REJECTED";
  const patch = async (p) => {
    setBusy(true);
    try { await editUmaAction(meetingId, a.id, p); onChanged(); }
    catch (e) { toast(apiErrorMessage(e, "That change couldn't be saved."), "error"); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    setBusy(true);
    try {
      const r = await approveUmaAction(meetingId, a.id);
      if (r.data.status === "CREATED") toast("Task created.", "success");
      else toast(r.data.failureReason || "The task couldn't be created.", "error");
      onChanged();
    } catch (e) { toast(apiErrorMessage(e, "The task couldn't be created."), "error"); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try { await rejectUmaAction(meetingId, a.id); onChanged(); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't dismiss it."), "error"); }
    finally { setBusy(false); }
  };
  const ownerHint = OWNER_TEXT[a.ownerState];
  const owners = [...(a.ownerCandidates || [])];
  team.forEach((t) => { if (!owners.some((o) => o.memberId === t.id)) owners.push({ memberId: t.id, name: t.name }); });
  return (
    <li className={`uma-action uma-action--${a.status.toLowerCase()}`}>
      <div className="uma-action-head">
        {canManage && !done && (
          <input type="checkbox" checked={selected} onChange={() => onSelect(a.id)} aria-label={`Select ${a.title}`} />
        )}
        {canManage && !done ? (
          <input className="uma-action-title" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== a.title && patch({ title })} aria-label="Action item title" />
        ) : <span className="uma-action-title uma-action-title--ro">{a.title}</span>}
        {a.status === "CREATED" && <span className="uma-pill uma-pill--success"><CheckCircle2 size={12} aria-hidden="true" />{a.automatic ? "Created automatically" : "Task created"}</span>}
        {a.status === "REJECTED" && <span className="uma-pill uma-pill--neutral">Dismissed</span>}
        {a.status === "FAILED" && <span className="uma-pill uma-pill--danger" title={a.failureReason || ""}>Not created</span>}
        {a.confidence === "LOW" && a.status === "PENDING" && <span className="uma-pill uma-pill--neutral" title="It was suggested rather than clearly agreed">Tentative</span>}
      </div>
      {a.description && a.description !== a.title && <p className="uma-action-desc">{a.description}</p>}
      {a.status === "PENDING" && a.reviewReason && <p className="uma-review-why"><AlertTriangle size={13} aria-hidden="true" />{a.reviewReason}</p>}
      {a.dependsOn && <p className="uma-fine">Depends on: {a.dependsOn}</p>}
      {a.ownerVerified && a.ownerBasis && <p className="uma-fine">Owner confirmed: {a.ownerBasis}</p>}
      <div className="uma-action-grid">
        <label><span>Owner {a.ownerSpoken ? <em>— said: “{a.ownerSpoken}”</em> : null}</span>
          <select value={a.ownerMemberId || ""} disabled={!canManage || done || busy}
            onChange={(e) => patch({ ownerMemberId: e.target.value || null })}>
            <option value="">{a.ownerMemberId ? "Nobody" : "Choose…"}</option>
            {owners.map((o) => <option key={o.memberId} value={o.memberId}>{o.name}</option>)}
          </select>
          {!a.ownerMemberId && ownerHint && <small className={a.ownerState === "UNASSIGNED" ? "" : "warn"}>{a.ownerNote || ownerHint}</small>}
        </label>
        <label><span>Due {a.dueSpoken ? <em>— said: “{a.dueSpoken}”</em> : null}</span>
          <input type="date" value={a.dueDate || ""} disabled={!canManage || done || busy} onChange={(e) => patch({ dueDate: e.target.value || null })} />
          {!a.dueDate && <small>{a.dueSpoken ? (a.dueSuggested ? `Probably ${a.dueSuggested} — please confirm` : "Couldn't work out the date — please pick it") : "No deadline was said"}</small>}
        </label>
        <label><span>Priority</span>
          <select value={a.priority || "MEDIUM"} disabled={!canManage || done || busy} onChange={(e) => patch({ priority: e.target.value })}>
            <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
          </select>
        </label>
        <label><span>Project</span>
          <select value={a.projectId || ""} disabled={!canManage || done || busy} onChange={(e) => patch({ projectId: e.target.value || null })}>
            <option value="">No project</option>
            {projects.filter((p) => OPEN_PROJECT(p) || p.id === a.projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="uma-action-foot">
        <span className="uma-fine">From the transcript <Refs evidence={a.evidence} onOpen={openLine} /></span>
        {a.status === "CREATED" && a.createdTaskId && <Link to={`/tasks?highlight=${a.createdTaskId}`} className="uma-link">Open task</Link>}
        {canManage && !done && (
          <span className="uma-action-buttons">
            <button type="button" className="btn-secondary pg-btn" onClick={reject} disabled={busy}>Dismiss</button>
            <button type="button" className="btn-primary pg-btn" onClick={approve} disabled={busy}><Check size={14} aria-hidden="true" />Create task</button>
          </span>
        )}
      </div>
    </li>
  );
}

function ActionsTab({ d, team, projects, openLine, onChanged }) {
  const { show: toast } = useToast();
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const actions = d.insights?.actions || [];
  const open = actions.filter((a) => a.status === "PENDING" || a.status === "FAILED");
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async () => {
    setBusy(true);
    try {
      const r = await approveUmaActions(d.meeting.id, [...selected]);
      const ok = r.data.filter((a) => a.status === "CREATED").length;
      toast(`${ok} task${ok === 1 ? "" : "s"} created.`, ok ? "success" : "error");
      setSelected(new Set()); onChanged();
    } catch (e) { toast(apiErrorMessage(e, "The tasks couldn't be created."), "error"); }
    finally { setBusy(false); }
  };
  if (!actions.length) return <p className="uma-hint">No action items were found in this meeting.</p>;
  return (
    <div>
      <p className="uma-hint">Nothing is created until you approve it. Owners and dates are only filled in when they were said in the meeting.</p>
      {d.canManage && open.length > 1 && (
        <div className="uma-bulk">
          <label className="uma-check"><input type="checkbox" checked={selected.size === open.length}
            onChange={(e) => setSelected(e.target.checked ? new Set(open.map((a) => a.id)) : new Set())} />
            <span>{selected.size ? `${selected.size} selected` : "Select all"}</span></label>
          {selected.size > 0 && <button type="button" className="btn-primary pg-btn" onClick={bulk} disabled={busy}><Check size={14} aria-hidden="true" />Create {selected.size} task{selected.size === 1 ? "" : "s"}</button>}
        </div>
      )}
      <ul className="uma-actions">
        {actions.map((a) => (
          <ActionCard key={`${a.id}:${a.title}`} a={a} meetingId={d.meeting.id} canManage={d.canManage} team={team} projects={projects}
            selected={selected.has(a.id)} onSelect={toggle} openLine={openLine} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

function AskTab({ d, openLine, onAsked }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = [...(d.questions || [])].reverse();
  const ask = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setError("");
    try { await askUma(d.meeting.id, q.trim()); setQ(""); onAsked(); }
    catch (err) { setError(apiErrorMessage(err, "The question couldn't be answered right now.")); }
    finally { setBusy(false); }
  };
  const examples = ["What did we decide?", "Who owns what, and by when?", "What risks were raised?"];
  return (
    <div className="uma-ask">
      <form onSubmit={ask} className="uma-ask-form">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this meeting" aria-label="Your question" maxLength={500} disabled={busy} />
        <button type="submit" className="btn-primary pg-btn" disabled={busy || !q.trim()}>
          {busy ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}Ask
        </button>
      </form>
      {!history.length && (
        <div className="uma-examples">{examples.map((x) => <button key={x} type="button" className="uma-chip" onClick={() => setQ(x)}>{x}</button>)}</div>
      )}
      <p className="uma-fine">Answers come only from this meeting's transcript, with the lines they're based on.</p>
      {error && <p className="uma-error" role="alert">{error}</p>}
      <ul className="uma-qa">
        {history.map((x) => (
          <li key={x.id}>
            <p className="uma-q"><MessageSquare size={13} aria-hidden="true" />{x.question}</p>
            <p className={`uma-a${x.grounded ? "" : " uma-a--none"}`}>{x.answer} <Refs evidence={x.evidence} onOpen={openLine} /></p>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function exportPdf(d) {
  const { default: jsPDF } = await import("jspdf");
  const res = await exportUma(d.meeting.id, "txt");
  const text = await res.data.text();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48, width = doc.internal.pageSize.getWidth() - margin * 2, bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  doc.setFont("helvetica", "normal");
  for (const raw of text.split("\n")) {
    const heading = raw && raw === raw.toUpperCase() && /[A-Z]/.test(raw) && !raw.startsWith("  ");
    doc.setFont("helvetica", heading ? "bold" : "normal");
    doc.setFontSize(heading ? 12 : 10);
    const lines = raw ? doc.splitTextToSize(raw, width) : [""];
    for (const l of lines) {
      if (y > bottom) { doc.addPage(); y = margin; }
      doc.text(l, margin, y);
      y += heading ? 18 : 14;
    }
  }
  doc.save(`${fileBase(d.meeting.title)}.pdf`);
}

function Detail({ id, team, projects }) {
  const navigate = useNavigate();
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const params = new URLSearchParams(window.location.search);
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(params.get("tab") || "overview");
  const [focusLine, setFocusLine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addRecording, setAddRecording] = useState(false);
  const [recordNow, setRecordNow] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 30000); return () => clearInterval(t); }, []);
  const [ffConnected, setFfConnected] = useState(false);
  useEffect(() => { getUmaFireflies().then((r) => setFfConnected(!!r.data?.connected)).catch(() => {}); }, []);
  const wasWorking = useRef(false);

  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    getUmaMeeting(id)
      .then((r) => { if (live) { setD(r.data); setError(""); } })
      .catch((e) => { if (live) setError(apiErrorMessage(e, "This meeting couldn't be loaded.")); });
    return () => { live = false; };
  }, [id, tick]);
  const waiting = !!d && d.meeting.status === "CREATED" && (d.capture?.pending?.length || 0) > 0;
  const working = d && (WORKING.has(d.meeting.status) || d.meeting.status === "CAPTURING" || waiting);
  useEffect(() => {
    if (!working) {
      if (wasWorking.current && d?.meeting.status === "REVIEW_READY") toast(d.meeting.statusDetail || "Your meeting summary is ready.", "success");
      wasWorking.current = false;
      return undefined;
    }
    wasWorking.current = true;
    const t = setInterval(() => setTick((n) => n + 1), waiting ? 15000 : 4000);   // waiting for a transcript: checks run every few minutes
    return () => clearInterval(t);
  }, [working, waiting, d, toast]);

  const openLine = (n) => { setTab("transcript"); setFocusLine(n); };
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok, "success"); load(); window.dispatchEvent(new Event("uma:changed")); }
    catch (e) { toast(apiErrorMessage(e, "That didn't work. Please try again."), "error"); }
    finally { setBusy(false); }
  };
  const doExport = async (format) => {
    try {
      if (format === "pdf") await exportPdf(d);
      else await saveBlob(await exportUma(id, format), `${fileBase(d.meeting.title)}.${format}`);
    } catch (e) { toast(apiErrorMessage(e, "The export couldn't be created."), "error"); }
  };

  if (error) return (
    <div className="pg-empty"><h2>Meeting not found</h2><p>{error}</p>
      <Link to="/ai-meeting-assistant" className="btn-secondary pg-btn"><ArrowLeft size={14} aria-hidden="true" />All meetings</Link></div>
  );
  if (!d) return <p className="uma-hint" role="status"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Loading…</p>;
  const m = d.meeting;
  const hasInsights = !!d.insights;
  const canAddContent = d.canManage && (m.status === "CREATED" || (m.status === "FAILED" && !d.segments?.length));

  return (
    <div className="uma-detail">
      <Link to="/ai-meeting-assistant" className="uma-back"><ArrowLeft size={14} aria-hidden="true" />All meetings</Link>
      <header className="pg-title-row">
        <div className="pg-title-text">
          <h1>{m.title}</h1>
          <p>
            <Pill status={m.status} label={d.statusLabel} />
            <span className="uma-sub">{SOURCE[m.source] || m.source}{m.provider && m.provider !== "OTHER" && d.provider ? ` · ${d.provider.name}` : ""}{m.meetingAt ? ` · ${when(m.meetingAt)}` : ""}</span>
          </p>
        </div>
        <div className="pg-title-actions">
          {hasInsights && (
            <ActionMenu label="Export" className="btn-secondary pg-btn" items={[
              { label: "Word document", icon: FileText, onSelect: () => doExport("docx") },
              { label: "PDF", icon: FileText, onSelect: () => doExport("pdf") },
              { label: "Markdown", icon: FileText, onSelect: () => doExport("md") },
              { label: "Plain text", icon: FileText, onSelect: () => doExport("txt") },
              { label: "JSON (data)", icon: FileText, onSelect: () => doExport("json") },
            ]}><Download size={14} aria-hidden="true" />Export</ActionMenu>
          )}
          {d.canManage && (
            <ActionMenu label="More actions for this meeting" items={[
              { label: "Write the summary again", icon: RefreshCw, hidden: !(m.status === "REVIEW_READY" || m.status === "COMPLETED"),
                onSelect: () => run(() => regenerateUmaMeeting(id), "Writing a new version…") },
              { label: m.visibility === "WORKSPACE" ? "Make private" : "Share with the workspace",
                onSelect: () => run(() => shareUmaMeeting(id, { visibility: m.visibility === "WORKSPACE" ? "PRIVATE" : "WORKSPACE" }),
                  m.visibility === "WORKSPACE" ? "Only you and admins can see it now." : "Everyone in the workspace can see it now.") },
              { label: "Mark as done", hidden: m.status !== "REVIEW_READY", onSelect: () => run(() => completeUmaMeeting(id), "Marked as done.") },
              { label: "Stop processing", hidden: !WORKING.has(m.status), onSelect: () => run(() => cancelUmaMeeting(id), "Stopped.") },
              "divider",
              { label: "Delete meeting", danger: true, onSelect: async () => {
                const ok = await confirm({ title: "Delete this meeting?", message: "Its transcript, summary and recording are deleted. Tasks already created stay.", confirmText: "Delete", danger: true });
                if (ok) { await run(() => deleteUmaMeeting(id), "Meeting deleted."); navigate("/ai-meeting-assistant"); }
              } },
            ]} />
          )}
        </div>
      </header>

      {WORKING.has(m.status) && (
        <div className="uma-working" role="status" aria-live="polite">
          <Loader2 size={16} className="uma-spin" aria-hidden="true" />
          <div>
            <strong>{m.statusDetail || d.statusLabel}</strong>
            <div className="uma-progress"><span style={{ width: `${Math.max(5, m.progressPercent || 0)}%` }} /></div>
            <small>You can leave this page; it keeps going.</small>
          </div>
        </div>
      )}
      {m.status === "FAILED" && (
        <div className="uma-failed" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>{m.statusDetail || "Something went wrong."}</strong>
            {m.recoveryHint && <p>{m.recoveryHint}</p>}
          </div>
          {d.canManage && (m.recording?.fileKey || d.segments?.length > 0) && (
            <button type="button" className="btn-primary pg-btn" onClick={() => run(() => retryUmaMeeting(id), "Trying again…")} disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" />Retry</button>
          )}
        </div>
      )}
      {m.status === "CREATED" && (
        <MeetingPanel m={m} d={d} id={id} ffConnected={ffConnected} busy={busy} run={run} nowTick={nowTick}
          onRecord={() => setRecordNow(true)} onAdd={() => setAddRecording(true)} />
      )}
      {m.status === "FAILED" && canAddContent && (
        <div className="uma-add-content">
          <button type="button" className="btn-primary pg-btn" onClick={() => setAddRecording(true)}><Upload size={14} aria-hidden="true" />Add the recording or transcript</button>
        </div>
      )}
      {m.status === "CAPTURING" && (
        <div className="uma-working" role="status">
          <span className="uma-rec-dot" aria-hidden="true" />
          <div><strong>Being recorded in a browser.</strong><small> It will be processed when the recording is stopped.</small></div>
        </div>
      )}
      {m.status === "REVIEW_READY" && d.insights && (
        <p className="uma-ready"><CheckCircle2 size={15} aria-hidden="true" />{m.statusDetail}</p>
      )}

      {(hasInsights || d.segments?.length > 0) && (
        <>
          <div className="uma-tabs" role="tablist" aria-label="Meeting results">
            {TABS.map(([k, label]) => {
              const n = k === "actions" ? d.insights?.actions?.filter((a) => a.status === "PENDING").length : 0;
              return (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className="uma-tab" onClick={() => setTab(k)}>
                  {label}{n ? <span className="uma-count">{n}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="uma-panel" role="tabpanel" aria-label={TABS.find(([k]) => k === tab)?.[1]}>
            {tab === "overview" && <Overview d={d} openLine={openLine} setTab={setTab} projects={projects} onChanged={load} />}
            {tab === "summary" && <SummaryTab ins={d.insights} openLine={openLine} />}
            {tab === "transcript" && <TranscriptTab d={d} focusLine={focusLine} canManage={d.canManage} onSaved={load} />}
            {tab === "decisions" && (
              <>
                <FindingList title="Decisions" items={d.insights?.decisions} openLine={openLine} empty="No decisions were recorded." />
                <FindingList title="Risks and blockers" items={d.insights?.risks} openLine={openLine} empty="None raised." />
                <FindingList title="Open questions" items={d.insights?.questions} openLine={openLine} empty="None left open." />
                <FindingList title="Follow-ups" items={d.insights?.followUps} openLine={openLine} empty="None." />
              </>
            )}
            {tab === "actions" && <ActionsTab d={d} team={team} projects={projects} openLine={openLine} onChanged={load} />}
            {tab === "ask" && <AskTab d={d} openLine={openLine} onAsked={load} />}
          </div>
        </>
      )}
      {recordNow && <AiMeetingRecorder meeting={m} onClose={() => setRecordNow(false)} onFinished={() => { setRecordNow(false); load(); }} />}
      {addRecording && <UploadDialog existingId={id} projects={projects} onClose={() => setAddRecording(false)}
        onDone={() => { setAddRecording(false); load(); }} />}
    </div>
  );
}

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { timeStyle: "short" }) : "");

/**
 * The one place that says, in plain words, where a meeting stands before its summary exists:
 * Scheduled -> In progress -> Ended, getting the transcript. One Join button; backup actions only while it can still help.
 */
function MeetingPanel({ m, d, id, ffConnected, busy, run, nowTick, onRecord, onAdd }) {
  const c = d.capture || {};
  const future = m.meetingAt && new Date(m.meetingAt) > new Date(nowTick);
  const phase = c.phase || (future ? "SCHEDULED" : c.pending?.length ? "STARTED" : "NONE");
  const live = phase === "SCHEDULED" || phase === "STARTED" || phase === "IN_PROGRESS";
  const ffAuto = ffConnected && m.autoFireflies;
  const isMeet = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(m.meetingUrl || "");

  let headline, detail = [];
  if (phase === "SCHEDULED") {
    headline = `Starts ${when(m.meetingAt)}.`;
    detail.push(ffAuto ? "Fireflies' notetaker joins by itself when it starts. In Google Meet, click Admit when it asks to join."
      : ffConnected ? "Nothing will record it unless you switch Fireflies on below." : "To have it recorded, connect Fireflies (Connections) or record it from this browser.");
  } else if (phase === "STARTED") {
    headline = "The meeting time has started.";
    if (c.firefliesJoining) detail.push("Fireflies' notetaker is on its way. In Google Meet, click Admit when it asks to join.");
    else if (c.firefliesSent) detail.push("Fireflies' notetaker was sent. If it's waiting to be let in, click Admit in Google Meet.");
    if (c.googleWatching) detail.push("Prowosma asks Google Meet every minute whether the call is running.");
  } else if (phase === "IN_PROGRESS") {
    headline = `In progress${c.startedAt ? ` since ${hhmm(c.startedAt)}` : ""}.`;
    if (c.firefliesInMeeting) detail.push("Fireflies is in the call, taking notes.");
    else if (c.firefliesJoining) detail.push("Fireflies' notetaker is on its way. Click Admit in Google Meet when it asks.");
    else if (c.firefliesSent) detail.push("Fireflies' notetaker was sent. If it's waiting to be let in, click Admit in Google Meet.");
    detail.push("The meeting ends when everyone has left, or when the host chooses \"End call for everyone\". Prowosma notices within about a minute.");
  } else if (phase === "ENDED") {
    headline = `Ended${c.endedAt ? ` at ${hhmm(c.endedAt)}` : ""}. Getting the transcript…`;
    detail.push("This usually takes 2-10 minutes. You can leave this page; the summary appears here by itself.");
  } else {
    headline = "Waiting for this meeting's recording or transcript.";
    detail.push("Nothing is set to capture it automatically. Add the recording or transcript below.");
  }
  const steps = [
    ["Meeting", phase === "ENDED" ? "done" : phase === "IN_PROGRESS" || phase === "STARTED" ? "now" : "next"],
    ["Transcript", phase === "ENDED" ? "now" : "next"],
    ["Summary", "next"],
  ];

  return (
    <section className="uma-mp" aria-label="Where this meeting stands">
      <ol className="uma-steps-bar">
        {steps.map(([label, state]) => (
          <li key={label} className={`uma-step uma-step--${state}`}>
            <span className="uma-step-dot" aria-hidden="true">{state === "done" ? <Check size={12} /> : null}</span>{label}
            <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (now)" : ""}</span>
          </li>
        ))}
      </ol>
      <div className="uma-mp-body" role="status" aria-live="polite">
        <p className="uma-mp-headline">{phase === "ENDED" && <Loader2 size={15} className="uma-spin" aria-hidden="true" />}{headline}</p>
        {detail.map((t) => <p key={t} className="uma-mp-detail">{t}</p>)}
        {c.lastCheckAt && (phase !== "SCHEDULED") && (
          <p className="uma-fine">Last checked {hhmm(c.lastCheckAt)}{c.nextCheckAt && new Date(c.nextCheckAt) > new Date(nowTick) ? `, next check ${hhmm(c.nextCheckAt)}` : ""}.
            {d.canManage && c.pending?.some((t) => t !== "FIREFLIES_JOIN") && (
              <> <button type="button" className="uma-link" disabled={busy} onClick={() => run(() => checkUmaMeeting(id), "Checking now…")}>Check now</button></>
            )}
          </p>
        )}
      </div>
      <div className="uma-mp-actions">
        {m.meetingUrl && live && (
          <a className="btn-primary pg-btn" href={m.meetingUrl} target="_blank" rel="noreferrer noopener"><Video size={15} aria-hidden="true" />Join meeting</a>
        )}
        {m.calendarLink && <a className="uma-link" href={m.calendarLink} target="_blank" rel="noreferrer noopener">Open in Google Calendar</a>}
      </div>
      {d.canManage && (
        <div className="uma-mp-more">
          {phase === "SCHEDULED" && ffConnected && (
            <label className="uma-check">
              <input type="checkbox" checked={!!m.autoFireflies} disabled={busy}
                onChange={(e) => run(() => setUmaAutoFireflies(id, e.target.checked),
                  e.target.checked ? "Fireflies will join by itself when it starts." : "Fireflies won't join this meeting.")} />
              <span>Fireflies joins by itself</span>
            </label>
          )}
          {(phase === "STARTED" || phase === "IN_PROGRESS") && ffConnected && m.meetingUrl && !c.firefliesInMeeting && (
            <button type="button" className="uma-link" disabled={busy}
              onClick={() => run(() => sendUmaNotetaker(id), "Fireflies is on its way. Click Admit in Google Meet when it asks.")}>Fireflies didn't arrive? Send it now</button>
          )}
          {live && <button type="button" className="uma-link" onClick={onRecord}>No notetaker? Record from this browser</button>}
          {phase === "NONE" && isMeet && (
            <button type="button" className="uma-link" disabled={busy} onClick={() => run(() => fetchUmaGoogle(id), "Asking Google Meet for the transcript…")}>Get Google Meet's transcript</button>
          )}
          <button type="button" className="uma-link" onClick={onAdd}>Have a recording or transcript? Add it</button>
        </div>
      )}
    </section>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AiMeetingAssistant() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null);
  const [team, setTeam] = useState([]);
  const [projects, setProjects] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [canCreate, setCanCreate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getTeamMembers().then((r) => setTeam(list(r).filter((t) => t.role !== "VIEWER"))).catch(() => {});
    getProjects().then((r) => setProjects(list(r))).catch(() => {});
    getUmaDashboard().then((r) => { setReadiness(r.data.readiness); setCanCreate(!!r.data.canCreate); setIsAdmin(!!r.data.isAdmin); }).catch(() => {});
  }, []);

  const done = useMemo(() => (m) => { setDialog(null); window.dispatchEvent(new Event("uma:changed")); if (m?.id) navigate(`/ai-meeting-assistant/${m.id}`); }, [navigate]);

  return (
    <div className="uma-page">
      {!id && (
        <header className="pg-title-row">
          <div className="pg-title-text">
            <h1>AI Meeting Assistant</h1>
            <p>Start or schedule a Google Meet or Teams meeting; afterwards the notes are written and agreed tasks are created for you.</p>
          </div>
          {canCreate && (
            <div className="pg-title-actions">
              <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog("connections")}><Plug size={15} aria-hidden="true" />Connections</button>
              <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog("settings")}><Settings size={15} aria-hidden="true" />Settings</button>
              <ActionMenu label="More ways to add a meeting" className="btn-secondary pg-btn" items={[
                { label: "Schedule a meeting", icon: CalendarPlus, onSelect: () => setDialog("schedule") },
                { label: "Add meeting link", icon: Link2, onSelect: () => setDialog("link") },
                { label: "Import transcript", icon: FileText, onSelect: () => setDialog("import") },
                { label: "Import from Fireflies", icon: Download, onSelect: () => setDialog("fireflies") },
              ]}><Plus size={15} aria-hidden="true" />Add</ActionMenu>
              <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog("upload")}><Upload size={15} aria-hidden="true" />Upload recording</button>
              <button type="button" className="btn-secondary pg-btn" onClick={() => setDialog("record")}><Circle size={13} fill="currentColor" aria-hidden="true" />Record meeting</button>
              <button type="button" className="btn-primary pg-btn" onClick={() => setDialog("instant")}><Video size={15} aria-hidden="true" />Meet now</button>
            </div>
          )}
        </header>
      )}
      {id ? <Detail key={id} id={id} team={team} projects={projects} /> : <Dashboard openDialog={setDialog} />}
      {dialog === "upload" && <UploadDialog projects={projects} readiness={readiness} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "import" && <ImportDialog projects={projects} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "instant" && <InstantDialog projects={projects} onClose={() => setDialog(null)} onDone={done}
        openConnections={() => setDialog("connections")} />}
      {dialog === "schedule" && <ScheduleDialog projects={projects} onClose={() => setDialog(null)} onDone={done}
        openConnections={() => setDialog("connections")} />}
      {dialog === "fireflies" && <FirefliesImportDialog projects={projects} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "connections" && <AiMeetingConnections isAdmin={isAdmin} onClose={() => setDialog(null)} onChanged={() => window.dispatchEvent(new Event("uma:changed"))} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "record" && <AiMeetingRecorder onClose={() => setDialog(null)} onFinished={(mid) => done({ id: mid })} />}
      {dialog === "link" && <LinkDialog projects={projects} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
