import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { apiErrorMessage } from "../utils/apiError";
import client from "../api/client";
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
  const [state, setState] = useState({ phase: "working", message: "", account: null, signedInAs: null });

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
        const res = await completeGoogleConnect(code, st);
        // Show both identities side by side: the Google account that was connected (only used to read transcripts) and the Prowosma
        // account that is still signed in. The server ties this sign-in to the person who started it, so these are never swapped.
        let signedInAs = null;
        try { signedInAs = (await client.get("/auth/profile")).data?.email || null; } catch { /* the line is simply left out */ }
        setState({ phase: "done", message: "Your Google account is connected.", account: res?.data?.account || null, signedInAs });
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
        {state.phase === "done" && (
          <div role="status">
            <p className="ma-ok">✓ {state.message}</p>
            {state.account && <p>Google account used to read transcripts: <strong>{state.account}</strong></p>}
            {state.signedInAs && <p>You are still signed in to Prowosma as: <strong>{state.signedInAs}</strong></p>}
            <p className="ma-hint">Connecting Google only lets Prowosma read your meeting transcripts. It never changes how you sign in to Prowosma.</p>
          </div>
        )}
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
