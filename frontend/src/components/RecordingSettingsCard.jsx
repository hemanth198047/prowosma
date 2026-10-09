/**
 * Admin settings for recording and speech-to-text: turn recording on, say which (free, self-hosted or paid) speech-to-text server turns audio into text,
 * how long audio is kept. The API key is write-only — once saved it is never shown again.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "./ToastContext";
import { apiErrorMessage } from "../utils/apiError";
import { getAssistantSettings, updateAssistantSettings, testSpeechToText } from "../api/meetingAssistant";

const RETENTION = [
  [0, "Delete as soon as it has been turned into text"],
  [6, "6 hours after the meeting ends"],
  [24, "24 hours after the meeting ends (recommended — lets a failed transcription be retried)"],
  [48, "48 hours"],
  [72, "72 hours"],
];

export default function RecordingSettingsCard({ recording, onChanged }) {
  const { show: toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [address, setAddress] = useState("");
  const [key, setKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState(null);

  const apply = useCallback((s) => {
    setEnabled(!!s.recordingEnabled);
    setAddress(s.sttBaseUrl || "");
    setKeySaved(!!s.sttKeySaved);
    setModel(s.sttModel || "");
    setLanguage(s.sttLanguage || "");
    setHours(typeof s.audioRetentionHours === "number" ? s.audioRetentionHours : 24);
    setKey("");
  }, []);

  useEffect(() => {
    let live = true;
    getAssistantSettings().then((r) => { if (live) { apply(r.data); setLoaded(true); } }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [apply]);

  const save = async (extra = {}) => {
    setBusy(true);
    setError("");
    try {
      const patch = { recordingEnabled: enabled, sttBaseUrl: address.trim(), sttModel: model.trim(), sttLanguage: language.trim(), audioRetentionHours: Number(hours), ...extra };
      if (key.trim()) patch.sttApiKey = key.trim();
      const { data } = await updateAssistantSettings(patch);
      apply(data);
      toast("Recording settings saved", "success");
      if (onChanged) await onChanged();
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save these settings."));
      return false;
    } finally { setBusy(false); }
  };

  const test = async () => {
    setTestResult(null);
    setBusy(true);
    try { setTestResult((await testSpeechToText()).data); }
    catch (e) { setTestResult({ ok: false, message: apiErrorMessage(e, "Couldn't run the test.") }); }
    finally { setBusy(false); }
  };

  if (!loaded) return null;

  return (
    <details className="ma-card ma-record-settings" open={!!recording && !recording.ready && enabled}>
      <summary><strong>Recording &amp; speech-to-text</strong> (admins) — {recording?.ready ? "on" : "off"}</summary>

      <p className="ma-hint">
        Lets people record a meeting in their browser — or upload a recording — for <em>any</em> platform and any Google account. Prowosma sends the audio to a speech-to-text server you choose,
        keeps only the text, and deletes the audio after the time below. Audio is stored encrypted.
      </p>
      {recording && !recording.ready && recording.reason && <div className="ma-warn">{recording.reason}</div>}

      <label className="ma-check-row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Allow recording and recording uploads in this workspace</span>
      </label>

      <div className="ma-field">
        <label htmlFor="stt-url">Speech-to-text server address</label>
        <input id="stt-url" type="url" placeholder="https://stt.your-company.com" value={address} onChange={(e) => setAddress(e.target.value)} />
        <span className="ma-hint">Any server that speaks the OpenAI “transcriptions” API: a free Whisper server on your own VPS, OpenAI, Groq… It must use https.</span>
      </div>
      <div className="ma-field">
        <label htmlFor="stt-key">API key (leave empty if your server needs none)</label>
        <input id="stt-key" type="password" autoComplete="new-password" placeholder={keySaved ? "A key is saved — type to replace it" : ""} value={key} onChange={(e) => setKey(e.target.value)} />
        {keySaved && <button type="button" className="ma-btn danger ma-small" disabled={busy} onClick={() => save({ clearSttApiKey: true })}>Remove the saved key</button>}
      </div>
      <div className="ma-fields">
        <div className="ma-field">
          <label htmlFor="stt-model">Model name</label>
          <input id="stt-model" type="text" placeholder="whisper-1" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="ma-field">
          <label htmlFor="stt-lang">Language (optional)</label>
          <input id="stt-lang" type="text" placeholder="detect automatically — or en, fr, pt-BR" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </div>
      </div>
      <div className="ma-field">
        <label htmlFor="stt-keep">Keep the audio</label>
        <select id="stt-keep" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {RETENTION.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
        </select>
      </div>

      {error && <div className="ma-error" role="alert">{error}</div>}
      {testResult && <div role="status" className={testResult.ok ? "ma-ok" : "ma-error"}>{testResult.ok ? "✓ " : ""}{testResult.message}</div>}
      <div className="ma-actions">
        <button type="button" className="ma-btn primary" disabled={busy} onClick={() => save()}>Save</button>
        <button type="button" className="ma-btn" disabled={busy || !address.trim()} onClick={test}>Test connection</button>
      </div>
      <p className="ma-hint">Set-up steps for a free speech-to-text server on your own VPS are in <code>docs/RECORDING_AND_SPEECH_TO_TEXT.md</code>. Test connection sends one second of silence; save first if you changed anything.</p>
    </details>
  );
}
