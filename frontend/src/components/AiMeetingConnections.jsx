/**
 * Connections for the AI Meeting Assistant: the workspace's Fireflies key (admins) and each person's own Google account (for Google Meet
 * transcripts). Keys are sent once to the server, stored encrypted there, and never shown again.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import SecretInput from "./ui/SecretInput";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import {
  getUmaFireflies, saveUmaFirefliesKey, removeUmaFireflies, getUmaGoogle, authorizeUmaGoogle, disconnectUmaGoogle,
} from "../api/aiMeetingAssistant";

export default function AiMeetingConnections({ isAdmin, onClose, onChanged }) {
  const { show: toast } = useToast();
  const [ff, setFf] = useState(null);
  const [google, setGoogle] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getUmaFireflies().then((r) => setFf(r.data)).catch(() => setFf({ connected: false }));
    getUmaGoogle().then((r) => setGoogle(r.data)).catch(() => setGoogle({ configured: false }));
  }, []);

  const saveKey = async () => {
    setBusy("ff"); setError("");
    try { const r = await saveUmaFirefliesKey(key.trim()); setFf(r.data); setKey(""); toast("Fireflies connected.", "success"); onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, "That key couldn't be saved.")); }
    finally { setBusy(""); }
  };
  const removeKey = async () => {
    setBusy("ff");
    try { const r = await removeUmaFireflies(); setFf(r.data); onChanged?.(); } catch (e) { setError(apiErrorMessage(e, "Couldn't disconnect.")); }
    finally { setBusy(""); }
  };
  const connectGoogle = async () => {
    setBusy("g"); setError("");
    try { const r = await authorizeUmaGoogle(); window.location.assign(r.data.url); }
    catch (e) { setError(apiErrorMessage(e, "Google sign-in couldn't start.")); setBusy(""); }
  };
  const disconnectGoogle = async () => {
    setBusy("g");
    try { const r = await disconnectUmaGoogle(); setGoogle(r.data); onChanged?.(); } catch (e) { setError(apiErrorMessage(e, "Couldn't disconnect.")); }
    finally { setBusy(""); }
  };

  return (
    <div className="uma-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="uma-dialog uma-dialog--wide" role="dialog" aria-modal="true" aria-label="Connections">
        <div className="uma-dialog-head">
          <h2>Connections</h2>
          <button type="button" className="uma-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="uma-form">
          <section className="uma-conn">
            <h3>Google Meet <span className="uma-fine">— your own Google account</span></h3>
            <p className="uma-hint">After a Google Meet meeting with transcription turned on, its transcript is read from Google automatically.</p>
            {!google ? <Loader2 size={14} className="uma-spin" aria-label="Loading" /> : !google.configured ? (
              <p className="uma-note uma-note--warn">Google sign-in isn't set up on the server yet. An admin needs to add the Google OAuth client (see the setup guide).</p>
            ) : google.connected ? (
              <div className="uma-conn-row">
                <span className="uma-ok"><CheckCircle2 size={14} aria-hidden="true" />Connected as {google.account}</span>
                <button type="button" className="btn-secondary pg-btn" onClick={disconnectGoogle} disabled={busy === "g"}>Disconnect</button>
              </div>
            ) : (
              <div className="uma-conn-row">
                {google.status === "NEEDS_REAUTH" && <span className="uma-fine">Google asked for a new sign-in.</span>}
                <button type="button" className="btn-primary pg-btn" onClick={connectGoogle} disabled={busy === "g" || google.canStoreTokens === false}>Connect Google account</button>
                {google.canStoreTokens === false && <span className="uma-fine">The server needs ENCRYPTION_KEY before sign-ins can be saved.</span>}
              </div>
            )}
          </section>

          <section className="uma-conn">
            <h3>Fireflies.ai <span className="uma-fine">— for the whole workspace</span></h3>
            <p className="uma-hint">Import Fireflies transcripts, and send the Fireflies notetaker into a running Google Meet, Zoom, Teams or Webex meeting.</p>
            {!ff ? <Loader2 size={14} className="uma-spin" aria-label="Loading" /> : ff.connected ? (
              <div className="uma-conn-row">
                <span className="uma-ok"><CheckCircle2 size={14} aria-hidden="true" />Connected{ff.account ? ` as ${ff.account}` : ""}{ff.source === "SERVER" ? " (server setting)" : ff.source === "MEETING_ASSISTANT" ? " (key from the Meeting Assistant page)" : ""}</span>
                {isAdmin && ff.source === "WORKSPACE" && <button type="button" className="btn-secondary pg-btn" onClick={removeKey} disabled={busy === "ff"}>Disconnect</button>}
              </div>
            ) : isAdmin ? (
              <div className="uma-conn-row">
                <SecretInput id="uma-ff-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Fireflies API key" />
                <button type="button" className="btn-primary pg-btn" onClick={saveKey} disabled={busy === "ff" || !key.trim()}>
                  {busy === "ff" ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : null}Connect
                </button>
              </div>
            ) : <p className="uma-fine">Not connected. Ask a workspace admin to add the Fireflies API key.</p>}
            {isAdmin && !ff?.connected && <p className="uma-fine">In Fireflies: Settings → Developer settings → API key. The key is checked with Fireflies, then stored encrypted.</p>}
          </section>
          {error && <p className="uma-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
