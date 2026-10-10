/** Admin settings for the Fireflies integration. The API key is write-only: once saved it is never shown again. */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { getAssistantSettings, updateAssistantSettings, testFireflies } from "../api/meetingAssistant";

export default function FirefliesSettingsCard({ fireflies, onChanged }) {
  const { show: toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState(null);

  const apply = useCallback((s) => { setEnabled(!!s.firefliesEnabled); setKeySaved(!!s.firefliesKeySaved); setKey(""); }, []);

  useEffect(() => {
    let live = true;
    getAssistantSettings().then((r) => { if (live) { apply(r.data); setLoaded(true); } }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [apply]);

  const save = async (extra = {}) => {
    setBusy(true);
    setError("");
    try {
      const patch = { firefliesEnabled: enabled, ...extra };
      if (key.trim()) patch.firefliesApiKey = key.trim();
      const { data } = await updateAssistantSettings(patch);
      apply(data);
      toast("Fireflies settings saved", "success");
      if (onChanged) await onChanged();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save these settings."));
    } finally { setBusy(false); }
  };

  const test = async () => {
    setTestResult(null);
    setBusy(true);
    try { setTestResult((await testFireflies()).data); }
    catch (e) { setTestResult({ ok: false, message: apiErrorMessage(e, "Couldn't run the test.") }); }
    finally { setBusy(false); }
  };

  if (!loaded) return null;

  return (
    <details className="ma-card ma-record-settings" open={!!fireflies && !fireflies.ready && enabled}>
      <summary><strong>Fireflies notetaker</strong> (admins) — {fireflies?.ready ? "on" : "off"}</summary>
      <p className="ma-hint">
        Lets people send a Fireflies notetaker to a running Google Meet, Zoom, Teams or Webex meeting — any account — and bring the transcript into Prowosma. It uses <em>your</em> Fireflies account:
        in Fireflies, open <em>Integrations → Fireflies API</em> and copy your API key. Fireflies' own plan limits apply (a free plan allows about 50 requests a day).
      </p>
      {fireflies && !fireflies.ready && fireflies.reason && <div className="ma-warn">{fireflies.reason}</div>}
      <label className="ma-check-row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Allow sending the Fireflies notetaker and importing from Fireflies</span>
      </label>
      <div className="ma-field">
        <label htmlFor="ff-key">Fireflies API key</label>
        <input id="ff-key" type="password" autoComplete="new-password" placeholder={keySaved ? "A key is saved — type to replace it" : ""} value={key} onChange={(e) => setKey(e.target.value)} />
        {keySaved && <button type="button" className="ma-btn danger ma-small" disabled={busy} onClick={() => save({ clearFirefliesApiKey: true })}>Remove the saved key</button>}
      </div>
      {error && <div className="ma-error" role="alert">{error}</div>}
      {testResult && <div role="status" className={testResult.ok ? "ma-ok" : "ma-error"}>{testResult.ok ? "✓ " : ""}{testResult.message}</div>}
      <div className="ma-actions">
        <button type="button" className="ma-btn primary" disabled={busy} onClick={() => save()}>Save</button>
        <button type="button" className="ma-btn" disabled={busy || !keySaved} onClick={test}>Test connection</button>
      </div>
      <p className="ma-hint">The Fireflies notetaker is visible to everyone in the meeting, and Fireflies keeps its own copy under your Fireflies account's settings. Setup notes are in <code>docs/FIREFLIES_INTEGRATION.md</code>.</p>
    </details>
  );
}
