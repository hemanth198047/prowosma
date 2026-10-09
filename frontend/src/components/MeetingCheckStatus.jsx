/**
 * MeetingCheckStatus — what the platform (Google Meet / Microsoft Teams) said the last time Prowosma looked for this meeting's transcript.
 * Without it a waiting meeting just repeats "Waiting…" forever. With it the person sees the real reason: no record yet, meeting still
 * running, no transcript was started, a personal Google account, and so on — plus when Prowosma will look again.
 */
import { providerName } from "../utils/meetingStatus";

const FACT_LABELS = {
  connectedAccount: "Connected account",
  accountType: "Account type",
  recordsReturned: "Meeting records Google returned",
  recordsFromThisMeetingsTime: "…from around this meeting's time",
  alreadyImportedElsewhere: "…already imported for another meeting",
  recordsFromOtherTimes: "…from other times",
  meetingStarted: "Meeting started",
  meetingEnded: "Meeting ended",
  transcriptSessions: "Transcription sessions at Google",
  transcriptsStillRunning: "…still running",
  willKeepCheckingUntil: "Prowosma keeps checking until",
  lines: "Lines imported",
  transcriptsReturned: "Transcripts returned for the organizer",
  fromThisMeeting: "…from this meeting",
  transcriptsFromThisMeeting: "Transcripts from this meeting",
  partsDone: "Parts turned into text",
  partsTotal: "Parts in total",
};
const ACCOUNT_TYPES = { PERSONAL: "Personal Google account", WORKSPACE_OR_OTHER: "Google Workspace (or other)" };
const TIME_KEYS = new Set(["meetingStarted", "meetingEnded", "willKeepCheckingUntil"]);

const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const full = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(); };

function ago(iso, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (Number.isNaN(min)) return "";
  if (min < 1) return "just now";
  if (min === 1) return "1 minute ago";
  if (min < 120) return `${min} minutes ago`;
  return `${Math.round(min / 60)} hours ago`;
}

function factValue(key, value) {
  if (key === "accountType") return ACCOUNT_TYPES[value] || String(value);
  if (TIME_KEYS.has(key)) return full(value);
  return String(value);
}

export default function MeetingCheckStatus({ session }) {
  const check = session.lastCheck;
  const platform = providerName(session.provider);
  const isRecording = session.provider === "RECORDING";
  const heading = isRecording ? "Recording progress" : `What Prowosma found at ${platform}`;
  const facts = check?.facts ? Object.entries(check.facts).filter(([, v]) => v !== null && v !== undefined && v !== "") : [];
  const tone = !check ? "" : ["IMPORTED"].includes(check.code) ? "ok" : /^GOOGLE_(SIGN_IN_EXPIRED|ACCESS_DENIED|NOT_CONNECTED)$/.test(check.code) ? "bad" : "info";

  return (
    <div className={`ma-check ${tone}`} aria-live="polite" aria-label={heading}>
      <h3>{heading}</h3>
      {check ? (
        <p><strong>Last checked {ago(check.at)} ({clock(check.at)}):</strong> {check.message}</p>
      ) : isRecording ? (
        <p>The recording hasn&rsquo;t been turned into text yet. Progress appears here once it starts.</p>
      ) : (
        <p>Prowosma hasn&rsquo;t looked yet. It checks about two minutes after you register a meeting and then every few minutes.
          {session.canManage ? " You can also press the check button below to look right now." : ""}</p>
      )}
      {session.nextCheckAt && <p className="ma-hint">Next automatic check: about {clock(session.nextCheckAt)}.</p>}
      {facts.length > 0 && (
        <details className="ma-check-facts">
          <summary>Technical details</summary>
          <dl>
            {facts.map(([k, v]) => (
              <div key={k}><dt>{FACT_LABELS[k] || k}</dt><dd>{factValue(k, v)}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
