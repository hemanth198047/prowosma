/** What is stored for a meeting's recording and when it goes — with a button to delete the audio now. */
import { useState } from "react";
import { useToast } from "./ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { deleteRecordingAudio } from "../api/meetingAssistant";

const STATE_TEXT = {
  RECORDING: "Recording in progress.",
  UPLOADED: "Recording received. Waiting to be turned into text.",
  TRANSCRIBING: "Turning the recording into text…",
  DONE: "The recording was turned into a transcript.",
  DELETED: "The recording was deleted.",
  EXPIRED: "The audio expired before it could be turned into text.",
};

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(); };

export default function SessionRecordingInfo({ session, onChanged }) {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const rec = session.recording;
  if (!rec) return null;
  const stored = !!rec.audioExpiresAt && !rec.audioDeletedAt;

  const remove = async () => {
    const ok = await confirm({
      title: "Delete the audio now?",
      message: rec.state === "DONE"
        ? "The audio is removed. The transcript made from it stays."
        : "The audio is removed and it will NOT be turned into text. You can upload a transcript or record again.",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try { await deleteRecordingAudio(session.id); toast("Audio deleted", "success"); await onChanged(); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't delete the audio."), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="ma-recording-info" aria-label="Recording">
      <strong>Recording:</strong> {STATE_TEXT[rec.state] || rec.state}
      {stored && <div className="ma-hint">The audio is stored encrypted until {when(rec.audioExpiresAt)}, then deleted automatically.</div>}
      {rec.audioDeletedAt && <div className="ma-hint">The audio was deleted on {when(rec.audioDeletedAt)}.</div>}
      {stored && session.canManage && (
        <div className="ma-actions"><button type="button" className="ma-btn danger" disabled={busy} onClick={remove}>Delete audio now</button></div>
      )}
    </div>
  );
}
