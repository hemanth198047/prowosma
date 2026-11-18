/**
 * Where Google (or Microsoft, with provider="microsoft") sends people back after they connect their account to the AI Meeting Assistant.
 * The code is handed to the server by a signed-in request.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { completeUmaGoogle, completeUmaMicrosoft } from "../api/aiMeetingAssistant";
import { apiErrorMessage } from "../utils/apiError";
import "../styles/pages/ai-meeting-assistant.css";

const NAME = { google: "Google", microsoft: "Microsoft" };

function initial(provider) {
  const q = new URLSearchParams(window.location.search);
  const name = NAME[provider];
  if (q.get("error")) {
    const desc = q.get("error_description") || "";
    if (/AADSTS65001|AADSTS90094|consent/i.test(desc)) return { phase: "error", message: "Your organisation's Microsoft admin hasn't approved this app yet. Ask them to grant admin consent (see the setup guide), then connect again." };
    return { phase: "error", message: q.get("error") === "access_denied" ? `${name} access wasn't allowed.` : `${name} didn't complete the sign-in.` };
  }
  if (!q.get("code") || !q.get("state")) return { phase: "error", message: `Open this page from Connect ${name} account.` };
  return { phase: "working" };
}

export default function AiMeetingGoogleCallback({ provider = "google" }) {
  const navigate = useNavigate();
  const [state, setState] = useState(() => initial(provider));
  const started = useRef(false);
  const name = NAME[provider];
  useEffect(() => {
    if (started.current || state.phase !== "working") return;     // the code works once; React may run effects twice in development
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    (provider === "microsoft" ? completeUmaMicrosoft : completeUmaGoogle)(q.get("code"), q.get("state"))
      .then((r) => {
        setState({ phase: "done", account: r.data.account, calendar: provider === "microsoft" ? r.data.canSchedule : r.data.calendar });
        setTimeout(() => navigate("/ai-meeting-assistant", { replace: true }), 2500);
      })
      .catch((e) => setState({ phase: "error", message: apiErrorMessage(e, `${name} sign-in couldn't be completed.`) }));
  }, [navigate, state.phase, provider, name]);
  return (
    <div className="uma-page">
      <div className="pg-empty">
        {state.phase === "working" && <p className="uma-hint"><Loader2 size={14} className="uma-spin" aria-hidden="true" /> Finishing the {name} connection…</p>}
        {state.phase === "done" && (
          <>
            <p className="uma-ok"><CheckCircle2 size={16} aria-hidden="true" />Connected as {state.account}</p>
            <p className="uma-hint">{state.calendar ? `You can now start and schedule ${provider === "microsoft" ? "Teams" : "Google Meet"} meetings from Prowosma.` : "Calendar access wasn't allowed, so only transcripts can be read."} Taking you back…</p>
          </>
        )}
        {state.phase === "error" && <p className="uma-error" role="alert">{state.message}</p>}
        {state.phase !== "working" && (
          <button type="button" className="btn-secondary pg-btn" onClick={() => navigate("/ai-meeting-assistant")}>Back to the AI Meeting Assistant</button>
        )}
      </div>
    </div>
  );
}
