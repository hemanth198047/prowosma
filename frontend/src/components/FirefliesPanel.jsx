/**
 * FirefliesPanel — send the Fireflies notetaker to a RUNNING meeting on any platform it supports (Google Meet, Zoom, Teams, Webex), or import a
 * transcript Fireflies already has. Works with any account, personal Gmail included. Shown only when an admin has set Fireflies up.
 */
import { useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { detectPlatform, SUPPORTED_TEXT, PLATFORM_NAMES, INSTANT_MEETING_TIPS } from "../utils/conferenceLink";
import { sendFirefliesNotetaker, getFirefliesRecent, importFirefliesTranscript } from "../api/meetingAssistant";

const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(); };

export default function FirefliesPanel({ onCreated }) {
  const { show: toast } = useToast();
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const [recent, setRecent] = useState(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState("");
  const [importConsent, setImportConsent] = useState(false);
  const [importing, setImporting] = useState("");

  const detected = detectPlatform(link);
  const showLinkProblem = link.trim() !== "" && !detected;

  const send = async () => {
    setError("");
    setSent(null);
    if (!detected) { setError(link.trim() ? SUPPORTED_TEXT : "Paste the link of the meeting that is running right now."); return; }
    if (!consent) { setError("Please confirm that everyone in the meeting knows a Fireflies notetaker will join, record and transcribe it."); return; }
    setBusy(true);
    try {
      const { data } = await sendFirefliesNotetaker({ meetingUrl: link.trim(), title: title.trim(), consent: true });
      setSent(PLATFORM_NAMES[data.platform] || detected.name);
      toast("Notetaker sent", "success");
      setLink(""); setTitle(""); setConsent(false);
      if (onCreated) await onCreated(data.id);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't send the notetaker."));
    } finally { setBusy(false); }
  };

  const loadRecent = async () => {
    setRecentError("");
    setLoadingRecent(true);
    try { setRecent((await getFirefliesRecent()).data); }
    catch (e) { setRecentError(apiErrorMessage(e, "Couldn't load your Fireflies meetings.")); }
    finally { setLoadingRecent(false); }
  };

  const importOne = async (m) => {
    setRecentError("");
    if (!importConsent) { setRecentError("Please confirm you have the right to import these transcripts."); return; }
    setImporting(m.id);
    try {
      const { data } = await importFirefliesTranscript({ transcriptId: m.id, consent: true });
      setRecent((list) => list.map((x) => (x.id === m.id ? { ...x, imported: true } : x)));
      toast("Transcript imported", "success");
      if (onCreated) await onCreated(data.id);
    } catch (e) {
      setRecentError(apiErrorMessage(e, "Couldn't import that meeting."));
    } finally { setImporting(""); }
  };

  return (
    <section className="ma-card ma-fireflies" aria-label="Fireflies notetaker">
      <h2>Fireflies notetaker</h2>
      <p className="ma-hint">
        A Fireflies notetaker joins your meeting, transcribes it, and Prowosma brings the transcript back — for Google Meet, Zoom, Teams or Webex, with any account.
        Send it while the meeting is <strong>running</strong>.
      </p>
      <ol className="ma-record-steps">
        <li>Start your meeting, then paste its link here.</li>
        <li>Press <strong>Send notetaker</strong>. It appears as a participant named “Fireflies” or “Fred”.</li>
        <li>If you're the host, <strong>admit it</strong> from the lobby. Prowosma imports the transcript after the meeting ends.</li>
      </ol>

      <div className="ma-field">
        <label htmlFor="ff-link">Meeting link (the meeting must be running)</label>
        <input id="ff-link" type="url" inputMode="url" placeholder="https://meet.google.com/…  or  https://zoom.us/j/…" value={link} onChange={(e) => setLink(e.target.value)} />
        {detected && <span className="ma-ok" role="status">✓ {detected.name} meeting</span>}
        {showLinkProblem && <span className="ma-hint" role="status">{SUPPORTED_TEXT}</span>}
        <details className="ma-hint ma-instant-tips">
          <summary>Started an instant meeting? How to find its link</summary>
          <ul>
            {INSTANT_MEETING_TIPS.map((t) => <li key={t.platform}><strong>{t.name}:</strong> {t.text}</li>)}
          </ul>
          <p>Instant, personal-room and scheduled meetings all work, as long as the meeting is running when you press Send.</p>
        </details>
      </div>
      <div className="ma-field">
        <label htmlFor="ff-title">Title (optional)</label>
        <input id="ff-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <label className="ma-check-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Everyone in the meeting knows a Fireflies notetaker will join, record and transcribe it</span>
      </label>
      {error && <div className="ma-error" role="alert">{error}</div>}
      {sent && <div className="ma-ok" role="status">✓ The notetaker was sent to your {sent} meeting. Admit it if you're the host — Prowosma imports the transcript after the meeting ends.</div>}
      <div className="ma-actions">
        <button type="button" className="ma-btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send notetaker"}</button>
      </div>

      <details className="ma-record-upload">
        <summary>Already have a meeting in Fireflies? Import it</summary>
        <div className="ma-upload-recording">
          <p className="ma-hint">For meetings Fireflies already recorded — for example from your calendar. Nothing is sent to the meeting; the transcript is copied into Prowosma.</p>
          <div className="ma-actions"><button type="button" className="ma-btn" disabled={loadingRecent} onClick={loadRecent}>{loadingRecent ? "Loading…" : "Load my recent Fireflies meetings"}</button></div>
          {recentError && <div className="ma-error" role="alert">{recentError}</div>}
          {recent && recent.length === 0 && <p className="ma-hint">No recent meetings were found in this Fireflies account.</p>}
          {recent && recent.length > 0 && (
            <>
              <label className="ma-check-row">
                <input type="checkbox" checked={importConsent} onChange={(e) => setImportConsent(e.target.checked)} />
                <span>I have the right to import these transcripts into Prowosma</span>
              </label>
              <ul className="ma-ff-list">
                {recent.map((m) => (
                  <li key={m.id}>
                    <div>
                      <strong>{m.title}</strong>
                      <div className="ma-meta">{when(m.date)}{m.platform ? ` · ${PLATFORM_NAMES[m.platform] || m.platform}` : ""}{m.live ? " · in progress" : ""}{m.imported ? " · already imported" : ""}</div>
                    </div>
                    <button type="button" className="ma-btn" disabled={m.imported || m.live || importing === m.id} onClick={() => importOne(m)} aria-label={`Import ${m.title}`}>
                      {m.imported ? "Imported" : importing === m.id ? "Importing…" : "Import"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
