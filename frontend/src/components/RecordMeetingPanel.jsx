/**
 * RecordMeetingPanel — record a meeting in the browser (any platform, any account) and turn it into a transcript.
 * The person starts it with one click and one confirmation in the browser's own "choose what to share" box (browsers never let a page skip that);
 * after that it records on its own until they stop it. Audio leaves the browser in short pieces, is turned into text on the server, then deleted.
 * Also lets people upload a recording they already have. Shown only when an admin has turned recording on and set up speech-to-text.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "./ToastContext";
import RecordingUpload from "./RecordingUpload";
import { apiErrorMessage } from "../utils/apiError";
import { SegmentedRecorder, createUploadQueue, formatClock } from "../utils/recorder";
import { startRecording, uploadRecordingChunk, finishRecording } from "../api/meetingAssistant";
import { ANNOUNCEMENT, retentionText } from "../utils/recordingText";

const browserCanRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

export default function RecordMeetingPanel({ recording, onCreated }) {
  const { show: toast } = useToast();
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [consent, setConsent] = useState(false);
  const [useMic, setUseMic] = useState(true);
  const [phase, setPhase] = useState("idle");        // idle | starting | recording | finishing | sent
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState({});
  const [micOn, setMicOn] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, pending: 0 });
  const live = useRef(null);                          // { sessionId, recorder, queue, streams, startedAt, ending }
  const supported = browserCanRecord();

  const stopStreams = (streams) => streams.forEach((s) => s?.getTracks?.().forEach((t) => t.stop()));

  const finish = useCallback(async (auto) => {
    const l = live.current;
    if (!l || l.ending) return;
    l.ending = true;
    setPhase("finishing");
    try {
      await l.recorder.stop();
      stopStreams(l.streams);
      await l.queue.drain();
      if (l.queue.failed.length > 0) setNotes((n) => [...n, `${l.queue.failed.length} short piece(s) of audio couldn't be sent, so those moments may be missing from the transcript.`]);
      try {
        await finishRecording(l.sessionId);
      } catch (e) {
        setNotes((n) => [...n, "Your audio was sent, but finishing didn't go through. Prowosma will finish it automatically in a few minutes."]);
        toast(apiErrorMessage(e, "Couldn't finish the recording right away."), "error");
      }
      toast(auto ? "Sharing ended, so the recording was finished" : "Recording finished", "success");
      setPhase("sent");
      if (onCreated) await onCreated(l.sessionId);
    } finally {
      live.current = null;
    }
  }, [onCreated, toast]);

  const start = async () => {
    setError("");
    setNotes([]);
    if (!consent) { setError("Please confirm that everyone in the meeting knows it is being recorded and turned into text."); return; }
    if (!supported) { setError("This browser can't record a meeting tab. Use Chrome or Edge on a computer."); return; }
    setPhase("starting");

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true, selfBrowserSurface: "exclude" });
    } catch (e) {
      setPhase("idle");
      setError(e?.name === "NotAllowedError" ? "Sharing was cancelled. Press Start recording again and choose your meeting tab." : "Couldn't start sharing the meeting tab. Please try again.");
      return;
    }
    const tabAudio = display.getAudioTracks();
    if (tabAudio.length === 0) {
      stopStreams([display]);
      setPhase("idle");
      setError("No meeting audio was shared. In the box your browser shows, choose the meeting TAB and tick “Share tab audio”, then try again.");
      return;
    }

    let mic = null;
    const warn = [];
    if (useMic) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { warn.push("Your microphone isn't available, so only the meeting audio is recorded — your own voice won't be labelled “You”."); }
    }

    let sessionId;
    try {
      const { data } = await startRecording({ title: title.trim(), consent: true });
      sessionId = data.id;
    } catch (e) {
      stopStreams([display, mic]);
      setPhase("idle");
      setError(apiErrorMessage(e, "Couldn't start the recording."));
      return;
    }

    const tracks = [{ name: "TAB", stream: new MediaStream(tabAudio) }];
    if (mic) tracks.push({ name: "MIC", stream: mic });
    const queue = createUploadQueue({
      send: (p) => uploadRecordingChunk(sessionId, p.track, p.seq, p.blob, p.startMs, p.durationMs),
      onProgress: setProgress,
    });
    const recorder = new SegmentedRecorder({
      tracks,
      segmentMs: (recording?.segmentSeconds || 180) * 1000,
      onSegment: (seg) => { if (!seg.silent) queue.enqueue(seg); },
      onError: () => setNotes((n) => (n.includes("The browser reported a recording problem.") ? n : [...n, "The browser reported a recording problem."])),
    });
    live.current = { sessionId, recorder, queue, streams: [display, mic], startedAt: Date.now(), ending: false };
    [...display.getVideoTracks(), ...tabAudio].forEach((t) => t.addEventListener("ended", () => finish(true)));
    recorder.start();
    setNotes(warn);
    setMicOn(!!mic);
    setElapsed(0);
    setProgress({ sent: 0, failed: 0, pending: 0 });
    setPhase("recording");
  };

  // While recording: the clock, the level meters, and a warning before the page is closed.
  useEffect(() => {
    if (phase !== "recording") return undefined;
    const tick = setInterval(() => {
      const l = live.current;
      if (!l) return;
      setElapsed((Date.now() - l.startedAt) / 1000);
      setLevels(l.recorder.levels());
    }, 500);
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { clearInterval(tick); window.removeEventListener("beforeunload", warn); };
  }, [phase]);

  // Leaving the page mid-recording must not leave the microphone and screen share running.
  useEffect(() => () => {
    const l = live.current;
    if (l && !l.ending) { l.recorder.stop(); stopStreams(l.streams); }
  }, []);

  const openMeeting = () => {
    let url;
    try { url = new URL(link.trim()); } catch { url = null; }
    if (!url || url.protocol !== "https:") { setError("Enter the full meeting link, starting with https://"); return; }
    setError("");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const copyAnnouncement = async () => {
    try { await navigator.clipboard.writeText(ANNOUNCEMENT); toast("Copied — paste it in the meeting chat or say it aloud", "success"); }
    catch { toast("Couldn't copy. You can say: " + ANNOUNCEMENT, "error"); }
  };

  const hours = recording?.retentionHours ?? 24;
  const recordingNow = phase === "recording";

  return (
    <section className="ma-card ma-record" aria-label="Record a meeting">
      <h2>Record a meeting</h2>

      {phase === "idle" || phase === "starting" ? (
        <>
          <p className="ma-hint">
            Works with Google Meet, Teams, Zoom or any meeting open in another browser tab — no Google Workspace needed. Prowosma records the meeting audio in your browser,
            turns it into text, and deletes the audio {retentionText(hours)}.
          </p>
          <ol className="ma-record-steps">
            <li>Open your meeting in another tab{" "}
              <a href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer">(start a new Google Meet)</a>.</li>
            <li>Come back here and press <strong>Start recording</strong>.</li>
            <li>In the box your browser shows, choose the <strong>meeting tab</strong> and tick <strong>Share tab audio</strong>.</li>
          </ol>
          {!supported && <div className="ma-warn" role="alert">This browser can't record a meeting tab. Use Chrome or Edge on a computer.</div>}

          <div className="ma-field">
            <label htmlFor="rec-link">Meeting link (optional — opens in a new tab)</label>
            <div className="ma-inline">
              <input id="rec-link" type="url" inputMode="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
              <button type="button" className="ma-btn" onClick={openMeeting}>Open meeting</button>
            </div>
          </div>
          <div className="ma-field">
            <label htmlFor="rec-title">Title (optional)</label>
            <input id="rec-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <label className="ma-check-row">
            <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
            <span>Also record my microphone, so my own voice is labelled “You”</span>
          </label>
          <label className="ma-check-row">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Everyone in the meeting knows it is being recorded and turned into text</span>
          </label>

          {error && <div className="ma-error" role="alert">{error}</div>}
          <div className="ma-actions">
            <button type="button" className="ma-btn primary" disabled={phase === "starting" || !supported} onClick={start}>
              {phase === "starting" ? "Starting…" : "Start recording"}
            </button>
          </div>
        </>
      ) : null}

      {recordingNow && (
        <div role="status" aria-live="polite">
          <div className="ma-record-live">
            <span className="ma-rec-dot" aria-hidden="true" />
            <strong>Recording {formatClock(elapsed)}</strong>
          </div>
          <div className="ma-meta">
            Meeting audio: {(levels.TAB ?? 0) > 0.01 ? "hearing sound" : "quiet right now"}
            {micOn && <> · Your microphone: {(levels.MIC ?? 0) > 0.01 ? "hearing you" : "quiet right now"}</>}
            {progress.sent > 0 && <> · {progress.sent} piece(s) sent</>}
          </div>
          <p className="ma-warn">Keep the meeting tab and this page open. Closing either one stops the recording. Everyone in the meeting should know it is being transcribed.</p>
          {notes.map((n) => <div key={n} className="ma-warn">{n}</div>)}
          <div className="ma-actions">
            <button type="button" className="ma-btn primary" onClick={() => finish(false)}>Stop and make the transcript</button>
            <button type="button" className="ma-btn" onClick={copyAnnouncement}>Copy announcement for the meeting</button>
          </div>
        </div>
      )}

      {phase === "finishing" && <p role="status" className="ma-hint">Sending the last of the audio…</p>}

      {phase === "sent" && (
        <div role="status">
          <p className="ma-ok">✓ Recording sent. Prowosma is turning it into text — follow it in your meetings below.</p>
          {notes.map((n) => <div key={n} className="ma-warn">{n}</div>)}
          <div className="ma-actions"><button type="button" className="ma-btn" onClick={() => { setPhase("idle"); setConsent(false); setTitle(""); }}>Record another</button></div>
        </div>
      )}

      {(phase === "idle" || phase === "sent") && (
        <details className="ma-record-upload">
          <summary>Already have a recording? Upload it instead</summary>
          <RecordingUpload recording={recording} onDone={onCreated} />
        </details>
      )}
    </section>
  );
}
