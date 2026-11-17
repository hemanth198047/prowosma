/**
 * Records a meeting in this browser for the AI Meeting Assistant: works with any meeting app (Google Meet, Teams, Zoom, Webex,
 * or a call in a desktop app if its window can be shared with audio). The meeting tab's sound and, if allowed, the person's
 * microphone are recorded as two tracks in short pieces and sent while the meeting runs, so very little is lost if something breaks.
 * Uses the same recorder as the existing Meeting Assistant (utils/recorder).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Mic, Square, X } from "lucide-react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { SegmentedRecorder, createUploadQueue, formatClock } from "../utils/recorder";
import { startUmaCapture, uploadUmaPiece, finishUmaCapture } from "../api/aiMeetingAssistant";

const browserCanRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

const stopStreams = (streams) => streams.forEach((s) => s?.getTracks?.().forEach((t) => t.stop()));

export default function AiMeetingRecorder({ meeting, onClose, onFinished }) {
  const { show: toast } = useToast();
  const [title, setTitle] = useState(meeting?.title || "");
  const [consent, setConsent] = useState(false);
  const [useMic, setUseMic] = useState(true);
  const [phase, setPhase] = useState("idle");          // idle | starting | recording | finishing
  const [error, setError] = useState("");
  const [notes, setNotes] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState({});
  const [micOn, setMicOn] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, pending: 0 });
  const live = useRef(null);
  const supported = browserCanRecord();

  const finish = useCallback(async (auto) => {
    const l = live.current;
    if (!l || l.ending) return;
    l.ending = true;
    setPhase("finishing");
    try {
      await l.recorder.stop();
      stopStreams(l.streams);
      await l.queue.drain();
      let lost = l.queue.failed.length;
      try { await finishUmaCapture(l.id); }
      catch (e) { toast(apiErrorMessage(e, "The recording was sent, but finishing didn't go through. It will finish by itself in a few minutes."), "error"); }
      toast(auto ? "Sharing ended, so the recording was finished." : "Recording finished. Writing the summary now.", "success");
      if (lost) toast(`${lost} short piece(s) of audio couldn't be sent, so those moments may be missing.`, "error");
      onFinished?.(l.id);
    } finally {
      live.current = null;
    }
  }, [onFinished, toast]);

  const start = async () => {
    setError(""); setNotes([]);
    if (!consent) return setError("Please confirm that everyone in the meeting knows it is being recorded and transcribed.");
    if (!supported) return setError("This browser can't record a meeting. Use Chrome or Edge on a computer.");
    setPhase("starting");
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true, selfBrowserSurface: "exclude" });
    } catch (e) {
      setPhase("idle");
      return setError(e?.name === "NotAllowedError" ? "Sharing was cancelled. Press Start recording and choose the meeting tab." : "Couldn't start sharing. Please try again.");
    }
    const tabAudio = display.getAudioTracks();
    if (tabAudio.length === 0) {
      stopStreams([display]); setPhase("idle");
      return setError("No meeting sound was shared. In the box the browser shows, choose the meeting TAB and switch on “Share tab audio”, then try again.");
    }
    let mic = null;
    const warn = [];
    if (useMic) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { warn.push("Your microphone isn't available, so only the meeting's sound is recorded."); }
    }
    let id;
    try {
      const { data } = await startUmaCapture({
        meetingId: meeting?.id, title: title.trim() || undefined, consent: true,
        meetingAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      id = data.id;
    } catch (e) {
      stopStreams([display, mic]); setPhase("idle");
      return setError(apiErrorMessage(e, "Couldn't start the recording."));
    }
    const tracks = [{ name: "TAB", stream: new MediaStream(tabAudio) }];
    if (mic) tracks.push({ name: "MIC", stream: mic });
    const queue = createUploadQueue({
      send: (p) => uploadUmaPiece(id, p.track, p.seq, p.blob, p.startMs, p.durationMs),
      onProgress: setProgress,
    });
    const recorder = new SegmentedRecorder({
      tracks,
      onSegment: (seg) => { if (!seg.silent) queue.enqueue(seg); },
      onError: () => setNotes((n) => (n.includes("The browser reported a recording problem.") ? n : [...n, "The browser reported a recording problem."])),
    });
    live.current = { id, recorder, queue, streams: [display, mic], startedAt: Date.now(), ending: false };
    [...display.getVideoTracks(), ...tabAudio].forEach((t) => t.addEventListener("ended", () => finish(true)));
    recorder.start();
    setNotes(warn); setMicOn(!!mic); setElapsed(0);
    setProgress({ sent: 0, failed: 0, pending: 0 });
    setPhase("recording");
  };

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

  // Closing the page mid-recording must not leave the screen share and microphone running.
  useEffect(() => () => {
    const l = live.current;
    if (l && !l.ending) { l.recorder.stop(); stopStreams(l.streams); }
  }, []);

  const busy = phase !== "idle";
  const hearing = (v) => (v ?? 0) > 0.01;

  return (
    <div className="uma-overlay" role="presentation">
      <div className="uma-dialog" role="dialog" aria-modal="true" aria-label="Record a meeting">
        <div className="uma-dialog-head">
          <h2>{phase === "recording" ? "Recording" : "Record a meeting"}</h2>
          {!busy && <button type="button" className="uma-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>}
        </div>

        {phase === "idle" || phase === "starting" ? (
          <div className="uma-form">
            <ol className="uma-steps">
              <li>Open your meeting (Google Meet, Teams, Zoom, Webex…) in another tab of this browser.</li>
              <li>Press <strong>Start recording</strong>, choose that tab, and switch on <strong>Share tab audio</strong>.</li>
              <li>Come back here and press <strong>Stop</strong> when the meeting ends. Keep both tabs open until then.</li>
            </ol>
            {!supported && <p className="uma-note uma-note--warn" role="alert">This browser can't record a meeting. Use Chrome or Edge on a computer.</p>}
            {!meeting && (
              <label className="uma-field"><span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly launch sync" maxLength={200} />
              </label>
            )}
            <label className="uma-check">
              <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
              <span>Also record my microphone (so what I say is included and labelled with my name)</span>
            </label>
            <label className="uma-check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Everyone in this meeting knows it is being recorded and transcribed.</span>
            </label>
            <p className="uma-fine">Audio is sent in short pieces while you record, turned into text, and the audio files are deleted afterwards.</p>
            {error && <p className="uma-error" role="alert">{error}</p>}
            <div className="uma-dialog-actions">
              <button type="button" className="btn-secondary pg-btn" onClick={onClose} disabled={phase === "starting"}>Cancel</button>
              <button type="button" className="btn-primary pg-btn" onClick={start} disabled={phase === "starting" || !supported}>
                <Circle size={13} fill="currentColor" aria-hidden="true" />{phase === "starting" ? "Starting…" : "Start recording"}
              </button>
            </div>
          </div>
        ) : (
          <div className="uma-form" aria-live="polite">
            <div className="uma-rec">
              <span className="uma-rec-dot" aria-hidden="true" />
              <strong className="uma-rec-clock">{formatClock(elapsed)}</strong>
              <span className="uma-fine">{progress.sent} piece{progress.sent === 1 ? "" : "s"} sent{progress.pending ? ` · ${progress.pending} waiting` : ""}{progress.failed ? ` · ${progress.failed} failed` : ""}</span>
            </div>
            <p className="uma-fine">
              Meeting sound: {hearing(levels.TAB) ? "hearing it" : "quiet right now"}
              {micOn && <> · <Mic size={12} aria-hidden="true" /> You: {hearing(levels.MIC) ? "hearing you" : "quiet right now"}</>}
            </p>
            <p className="uma-note uma-note--warn">Keep the meeting tab and this page open. Closing either one stops the recording.</p>
            {notes.map((n) => <p key={n} className="uma-note uma-note--warn">{n}</p>)}
            <div className="uma-dialog-actions">
              <button type="button" className="btn-primary pg-btn" onClick={() => finish(false)} disabled={phase === "finishing"}>
                <Square size={13} fill="currentColor" aria-hidden="true" />{phase === "finishing" ? "Finishing…" : "Stop and summarise"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
