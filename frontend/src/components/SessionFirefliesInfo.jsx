/** What Fireflies is doing for a meeting — and, on a waiting meeting that has a link, a way to send the notetaker to it. */
import { useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { sendFirefliesNotetaker } from "../api/meetingAssistant";

const at = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };

export default function SessionFirefliesInfo({ session, firefliesCaps, waiting, onChanged }) {
  const { show: toast } = useToast();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ff = session.fireflies;

  if (ff) {
    const name = ff.platformName && ff.platformName !== "Unknown platform" ? `${ff.platformName} meeting` : "meeting";
    return (
      <div className="ma-recording-info" aria-label="Fireflies">
        <strong>Fireflies:</strong>{" "}
        {ff.state === "IMPORTED"
          ? "The transcript came from Fireflies."
          : `The notetaker was sent to your ${name}${ff.sentAt ? ` at ${at(ff.sentAt)}` : ""}. Waiting for its transcript — if you're the host, make sure you admitted it.`}
      </div>
    );
  }

  const canSend = firefliesCaps?.ready && session.canManage && !session.simulated && !!session.meetingUrl && waiting && session.provider !== "RECORDING";
  if (!canSend) return null;

  const send = async () => {
    setError("");
    if (!consent) { setError("Please confirm that everyone in the meeting knows a Fireflies notetaker will join, record and transcribe it."); return; }
    setBusy(true);
    try {
      await sendFirefliesNotetaker({ sessionId: session.id, consent: true });
      toast("Notetaker sent", "success");
      setConsent(false);
      await onChanged();
    } catch (e) { setError(apiErrorMessage(e, "Couldn't send the notetaker.")); }
    finally { setBusy(false); }
  };

  return (
    <details className="ma-guide">
      <summary>No transcript? Send a Fireflies notetaker to this meeting</summary>
      <div className="ma-guide-body">
        <p>Works for any account. The meeting has to be <strong>running</strong> now. The notetaker joins as a participant named “Fireflies” or “Fred” — admit it if you're the host.</p>
        <label className="ma-check-row">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Everyone in the meeting knows a Fireflies notetaker will join, record and transcribe it</span>
        </label>
        {error && <div className="ma-error" role="alert">{error}</div>}
        <div className="ma-actions"><button type="button" className="ma-btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send notetaker"}</button></div>
      </div>
    </details>
  );
}
