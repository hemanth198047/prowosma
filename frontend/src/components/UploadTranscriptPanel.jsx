/**
 * UploadTranscriptPanel — turn a transcript you ALREADY HAVE into a meeting, summary, minutes, tasks and projects.
 * No meeting link and no running meeting are needed: it works for a call that happened anywhere (Meet, Zoom, Teams, a phone, a room, Fireflies, someone else's recording).
 * Choose a file (.txt, .vtt, .srt, .docx) or paste the text. The server reads it, makes a new meeting from it and starts the normal pipeline;
 * the new meeting opens so its action items can be reviewed before any task or project is created.
 */
import { useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { createMeetingFromTranscriptFile, createMeetingFromTranscriptText } from "../api/meetingAssistant";

const ACCEPT = ".txt,.vtt,.srt,.docx,text/plain,text/vtt";
const FALLBACK_MAX = 5_000_000;
const mb = (bytes) => Math.round(bytes / 1_000_000);

export default function UploadTranscriptPanel({ projects = [], aiReady = true, aiReason = "", autoCreate = false, limits, onCreated }) {
  const { show: toast } = useToast();
  const max = limits?.maxBytes || FALLBACK_MAX;
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = (e) => {
    const f = e.target.files?.[0] || null;
    setError("");
    if (f && f.size > max) { setFile(null); setError(`That file is ${mb(f.size)} MB. The limit is ${mb(max)} MB — split the transcript into parts and upload them one at a time.`); return; }
    setFile(f);
    if (f) setText("");                                   // one source at a time: the file wins until it is removed
  };

  const clearFile = () => { setFile(null); const el = document.getElementById("ut-file"); if (el) el.value = ""; };

  const send = async (e) => {
    e?.preventDefault?.();
    setError(""); setWarnings([]);
    if (!file && !text.trim()) { setError("Choose a transcript file or paste the transcript text first."); return; }
    if (!consent) { setError("Please confirm you have the right to use this transcript."); return; }
    setBusy(true);
    try {
      const { data } = file
        ? await createMeetingFromTranscriptFile(file, { consent: true, title: title.trim(), projectId, onProgress: setProgress })
        : await createMeetingFromTranscriptText({ content: text, title: title.trim(), projectId: projectId || null, consent: true });
      setWarnings(data.warnings || []);
      toast("Transcript added as a new meeting", "success");
      clearFile(); setText(""); setTitle(""); setConsent(false);
      if (onCreated) await onCreated(data.id);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't add that transcript."));
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <section className="ma-card ma-upload-transcript" aria-label="Upload a transcript">
      <h2>Upload a transcript</h2>
      <p className="ma-hint">
        Already have the transcript of a meeting that is over? Upload it here — no meeting link is needed and the meeting doesn't have to be running.
        Prowosma writes the summary and minutes, finds the action items and proposed projects, and lets you review them before any task or project is created
        {autoCreate ? " (your workspace may also create some automatically)." : "."}
      </p>
      {!aiReady && (
        <div className="ma-warn" role="status">
          The transcript will be saved, but summaries, action items and tasks need AI to be set up first. {aiReason || "Ask an admin to finish AI Settings."}
        </div>
      )}
      <form onSubmit={send} aria-label="Upload a transcript form" noValidate>
        <div className="ma-field">
          <label htmlFor="ut-file">Transcript file (.txt, .vtt, .srt or Word .docx — up to {mb(max)} MB)</label>
          <input id="ut-file" type="file" accept={ACCEPT} onChange={pick} />
          {file && <span className="ma-hint">{file.name} <button type="button" className="ma-btn" onClick={clearFile}>Remove</button></span>}
          <span className="ma-hint">Google Meet transcripts saved in Drive: open the document and use File → Download → Microsoft Word (.docx) or Plain text. For a PDF, save it as .docx or paste the text.</span>
        </div>
        <div className="ma-field">
          <label htmlFor="ut-text">Or paste the transcript text here</label>
          <textarea id="ut-text" rows={5} value={text} disabled={!!file} onChange={(e) => setText(e.target.value)}
            placeholder={"Priya: Let's ship the billing fix by Friday.\nArjun: I'll take the invoice export."} />
        </div>
        <div className="ma-field">
          <label htmlFor="ut-title">Title (optional — the file name is used if you leave it empty)</label>
          <input id="ut-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="ma-field">
          <label htmlFor="ut-project">Project for the new meeting</label>
          <select id="ut-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Detect from discussion</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <label className="ma-check-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I have the right to use this transcript. Its text is sent to the AI provider my workspace uses to write the summary and find tasks.</span>
        </label>
        {error && <div className="ma-error" role="alert">{error}</div>}
        {warnings.length > 0 && <p className="ma-warn" role="status">{warnings.join(" ")}</p>}
        {progress !== null && <progress max="1" value={progress} aria-label="Upload progress" />}
        <div className="ma-actions">
          <button type="submit" className="ma-btn primary" disabled={busy}>{busy ? "Uploading…" : "Create meeting from transcript"}</button>
        </div>
      </form>
    </section>
  );
}
