import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { apiErrorMessage } from "../utils/apiError";
import { completeGoogleConnect } from "../api/meetingAssistant";
import "../styles/pages/meeting-assistant.css";

/**
 * Where Google sends the person back after they approve (or refuse) access. This is an ordinary signed-in page,
 * so the code is handed to the server by an authenticated request — no public callback endpoint exists.
 */
export default function GoogleMeetCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const started = useRef(false);
  const [state, setState] = useState({ phase: "working", message: "" });

  useEffect(() => {
    if (started.current) return;            // React may run effects twice in development; the code is single-use
    started.current = true;
    (async () => {
      const denied = params.get("error");
      const code = params.get("code");
      const st = params.get("state");
      if (denied) {
        setState({ phase: "error", message: denied === "access_denied"
          ? "You didn't allow access, so nothing was connected. You can try again whenever you like."
          : "Google couldn't complete the sign-in. Please try again." });
        return;
      }
      if (!code || !st) { setState({ phase: "error", message: "This page needs to be opened from the Google sign-in. Start again from Meeting Platforms." }); return; }
      try {
        await completeGoogleConnect(code, st);
        setState({ phase: "done", message: "Your Google account is connected." });
      } catch (e) {
        setState({ phase: "error", message: apiErrorMessage(e, "Couldn't finish connecting your Google account.") });
      }
    })();
  }, [params]);

  return (
    <div>
      <PageHeader icon="🟢" title="Connecting Google Meet" />
      <div className="ma-card" aria-live="polite">
        {state.phase === "working" && <p>Finishing the connection…</p>}
        {state.phase === "done" && <p className="ma-ok" role="status">✓ {state.message}</p>}
        {state.phase === "error" && <p className="ma-error" role="alert">{state.message}</p>}
        {state.phase !== "working" && (
          <div className="ma-actions">
            <button className="ma-btn primary" onClick={() => navigate("/integrations/meeting-platforms")}>Back to Meeting Platforms</button>
          </div>
        )}
      </div>
    </div>
  );
}
