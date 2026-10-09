/** Upload an audio/video recording — as a new meeting, or (with sessionId) for a meeting that already exists. */
import { useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { uploadRecordingFile } from "../api/meetingAssistant";

const ACCEPT = "audio/*,.webm,.ogg,.wav,.mp3,.m4a,.mp4,.flac,.aac";
const mb = (bytes) => Math.round(bytes / 1_000_000);

export default function RecordingUpload({ recording, sessionId, onDone }) {
  const { show: toast } = useToast();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const max = recording?.maxUploadBytes || 25_000_000;
  const id = sessionId ? `up-${sessionId}` : "up-new";

  const pick = (e) => {
    const f = e.target.files?.[0] || null;
    setError("");
    if (f && f.size > max) { setFile(null); setError(`That file is ${mb(f.size)} MB. The limit is ${mb(max)} MB — record at a lower quality or split it into parts.`); return; }
    setFile(f);
  };

  const send = async () => {
    setError("");
    if (!file) { setError("Choose a recording first."); return; }
    if (!consent) { setError("Please confirm you have the right to use this recording and that its participants know it is being turned into text."); return; }
    setBusy(true);
    setProgress(0);
    try {
      const { data } = await uploadRecordingFile(sessionId, file, { consent: true, title: title.trim(), onProgress: setProgress });
      toast("Recording uploaded. Prowosma is turning it into text.", "success");
      setFile(null); setConsent(false); setTitle("");
      if (onDone) await onDone(data.id);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't upload that recording."));
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="ma-upload-recording">
      <div className="ma-field">
        <label htmlFor={`${id}-file`}>Audio or video file (up to {mb(max)} MB)</label>
        <input id={`${id}-file`} type="file" accept={ACCEPT} onChange={pick} />
        <span className="ma-hint">Speakers can't be told apart in an uploaded file, so they're shown as unknown.</span>
      </div>
      {!sessionId && (
        <div className="ma-field">
          <label htmlFor={`${id}-title`}>Title (optional)</label>
          <input id={`${id}-title`} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}
      <label className="ma-check-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>I have the right to use this recording, and its participants know it is being turned into text</span>
      </label>
      {error && <div className="ma-error" role="alert">{error}</div>}
      {progress !== null && <progress max="1" value={progress} aria-label="Upload progress" />}
      <div className="ma-actions">
        <button type="button" className="ma-btn primary" disabled={busy} onClick={send}>{busy ? "Uploading…" : "Upload recording"}</button>
      </div>
    </div>
  );
}
