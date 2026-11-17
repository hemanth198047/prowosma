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
  setUmaGooglePrefs, syncUmaCalendar,
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
  const setPref = async (prefs) => {
    setBusy("gp"); setError("");
    try { const r = await setUmaGooglePrefs(prefs); setGoogle(r.data); onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, "That couldn't be changed.")); }
    finally { setBusy(""); }
  };
  const syncNow = async () => {
    setBusy("gs"); setError("");
    try {
      const r = await syncUmaCalendar();
      toast(r.data.added ? `${r.data.added} meeting(s) added from your calendar.` : "Your calendar is up to date.", "success");
      const st = await getUmaGoogle(); setGoogle(st.data); onChanged?.();
    } catch (e) { setError(apiErrorMessage(e, "The calendar couldn't be read.")); }
    finally { setBusy(""); }
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
            <h3>Google <span className="uma-fine">- your own Google account</span></h3>
            <p className="uma-hint">Schedule Google Meet meetings from here, add your upcoming Meet meetings automatically, and have Google Meet's transcript read after each meeting.</p>
            {!google ? <Loader2 size={14} className="uma-spin" aria-label="Loading" /> : !google.configured ? (
              <p className="uma-note uma-note--warn">Google sign-in isn't set up on the server yet. An admin adds the Google OAuth client (see the setup guide). Redirect address to register in Google Cloud: <code>{google.redirectUri}</code></p>
            ) : google.connected && !google.legacyConnection ? (
              <>
                <div className="uma-conn-row">
                  <span className="uma-ok"><CheckCircle2 size={14} aria-hidden="true" />Connected as {google.account}</span>
                  <button type="button" className="btn-secondary pg-btn" onClick={disconnectGoogle} disabled={!!busy}>Disconnect</button>
                </div>
                {!google.calendar && <p className="uma-note uma-note--warn">Calendar access wasn't allowed. Disconnect and connect again to schedule meetings.</p>}
                {google.calendar && (
                  <div className="uma-toggle-list">
                    <label className="uma-check">
                      <input type="checkbox" checked={!!google.autoImportCalendar} disabled={!!busy} onChange={(e) => setPref({ autoImportCalendar: e.target.checked })} />
                      <span>Add my upcoming Google Meet meetings from Google Calendar automatically (checked every 10 minutes, next 7 days)</span>
                    </label>
                    <label className="uma-check">
                      <input type="checkbox" checked={!!google.autoFireflies} disabled={!!busy || !ff?.connected} onChange={(e) => setPref({ autoFireflies: e.target.checked })} />
                      <span>…and send the Fireflies notetaker to them when they start{!ff?.connected ? " (connect Fireflies first)" : ""}</span>
                    </label>
                    {google.autoImportCalendar && (
                      <div className="uma-conn-row">
                        <button type="button" className="btn-secondary pg-btn" onClick={syncNow} disabled={!!busy}>
                          {busy === "gs" ? <Loader2 size={14} className="uma-spin" aria-hidden="true" /> : null}Check my calendar now
                        </button>
                        {google.lastCalendarSyncAt && <span className="uma-fine">Last checked {new Date(google.lastCalendarSyncAt).toLocaleTimeString([], { timeStyle: "short" })}: {google.lastCalendarSyncNote}</span>}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="uma-conn-row">
                {google.legacyConnection && <span className="uma-fine">Connected on the Meeting Platforms page for transcripts only. Connect here to also schedule meetings and use your calendar.</span>}
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
