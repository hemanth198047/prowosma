import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { useRole } from "../hooks/useRole";
import { apiErrorMessage } from "../utils/apiError";
import {
  getMeetingPlatforms, setMeetingPlatformEnabled, testMeetingPlatform, disconnectMeetingPlatform,
  getAssistantSettings, updateAssistantSettings, getAssistantCapabilities,
  getGoogleConnection, startGoogleConnect, disconnectGoogle,
} from "../api/meetingAssistant";
import { PROVIDER_META } from "../utils/meetingStatus";
import "../styles/pages/meeting-assistant.css";

const GOOD_TO_KNOW = {
  GOOGLE_MEET: [
    "Transcripts exist only if transcription was turned on during the meeting.",
    "Google's live-audio interface is still a limited developer preview, so live joining isn't offered.",
    "Google only allows each person to sign in for themselves, so imports use the access of the person who registered the meeting.",
  ],
  MS_TEAMS: [
    "Transcripts exist only if transcription was started during the meeting, and a Microsoft 365 admin can switch off transcript access for apps.",
    "Live audio needs a separate Windows-hosted service, which isn't part of this setup.",
  ],
};

const CONNECTION = {
  NOT_CONNECTED:   { label: "Not connected",   tone: "neutral" },
  CONNECTED:       { label: "Connected",       tone: "success" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "danger" },
};

function PlatformCard({ p, caps, google, onChanged }) {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const meta = PROVIDER_META[p.provider] || { name: p.provider, icon: "•" };
  const conn = CONNECTION[p.connectionStatus] || CONNECTION.NOT_CONNECTED;
  const isGoogle = p.provider === "GOOGLE_MEET";
  const cap = caps?.platforms?.find((x) => x.provider === p.provider);
  const autoText = !isGoogle
    ? "Automatic transcript import: not available yet"
    : !caps?.googleConfigured
      ? "Automatic transcript import: needs server setup (Google sign-in credentials and encryption)"
      : google?.connected
        ? `Automatic transcript import: on for your account${google.account ? ` (${google.account})` : ""}`
        : "Automatic transcript import: available once you connect your Google account";

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok, "success"); await onChanged(); return r; }
    catch (e) { toast(apiErrorMessage(e, "That didn't work. Please try again."), "error"); return null; }
    finally { setBusy(false); }
  };

  const test = async () => {
    const r = await run(() => testMeetingPlatform(p.provider));
    if (r) setResult(r.data);
  };
  const connectGoogle = async () => {
    setBusy(true);
    try {
      const r = await startGoogleConnect();
      window.location.assign(r.data.url);
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't start the Google sign-in."), "error");
      setBusy(false);
    }
  };
  const removeGoogle = async () => {
    const ok = await confirm({ title: "Disconnect your Google account?",
      message: "Prowosma will stop importing transcripts with your access, and the saved sign-in is deleted.", danger: true });
    if (ok) { await run(() => disconnectGoogle(), "Google account disconnected"); }
  };
  const disconnect = async () => {
    const ok = await confirm({
      title: `Disconnect ${meta.name}?`,
      message: "People will no longer be able to register meetings on this platform. Meetings already registered keep their history.",
      danger: true,
    });
    if (ok) { setResult(null); await run(() => disconnectMeetingPlatform(p.provider), "Disconnected"); }
  };

  return (
    <section className="ma-card" aria-label={meta.name}>
      <div className="ma-row-top">
        <h2 style={{ margin: 0 }}><span aria-hidden="true">{meta.icon}</span> {meta.name}</h2>
        <span className={`ma-chip ${conn.tone}`}>{conn.label}</span>
      </div>

      <p style={{ margin: "12px 0" }}>
        <label className="ma-switch">
          <input type="checkbox" checked={p.enabled} disabled={busy}
            onChange={(e) => run(() => setMeetingPlatformEnabled(p.provider, e.target.checked),
              e.target.checked ? "Enabled" : "Disabled")} />
          Allow people to register {meta.name} meetings
        </label>
      </p>

      <strong style={{ fontSize: 13 }}>What works today</strong>
      <ul className="ma-caps">
        <li>Live joining: not available</li>
        <li>{autoText}</li>
        <li>Upload or paste a transcript: {cap?.manualTranscriptUpload === false ? "not available" : "available"}</li>
      </ul>
      <strong style={{ fontSize: 13, display: "block", marginTop: 10 }}>Good to know</strong>
      <ul className="ma-caps">{GOOD_TO_KNOW[p.provider]?.map((t) => <li key={t}>{t}</li>)}</ul>

      <strong style={{ fontSize: 13, display: "block", marginTop: 10 }}>Setup steps</strong>
      <ol className="ma-caps">
        <li>Turn the switch above on so people can register meetings.</li>
        {isGoogle ? (
          <li>Each person who registers Google Meet meetings connects their own Google account once. Prowosma can then read only the meetings that account can access.</li>
        ) : (
          <li>Automatic import for Microsoft Teams isn't available yet. People add the transcript by upload or paste.</li>
        )}
        <li>Use Test connection to confirm everything is healthy.</li>
      </ol>

      <div className="ma-actions">
        {isGoogle ? (
          google?.connected
            ? <button className="ma-btn" disabled={busy} onClick={removeGoogle}>Disconnect my Google account</button>
            : <button className="ma-btn primary" disabled={busy || !caps?.googleConfigured} onClick={connectGoogle}
                title={caps?.googleConfigured ? "" : "Google sign-in isn't set up on the server yet"}>Connect my Google account</button>
        ) : (
          <button className="ma-btn primary" disabled title="Not available yet">Connect</button>
        )}
        <button className="ma-btn" disabled={busy} onClick={test}>Test connection</button>
        <button className="ma-btn danger" disabled={busy} onClick={disconnect}>Disconnect</button>
      </div>

      <div aria-live="polite">
        {result && <p className={result.healthy ? "ma-ok" : "ma-warn"}>{result.message}</p>}
        {!result && p.lastCheckedAt && <p className="ma-hint">Last checked {new Date(p.lastCheckedAt).toLocaleString()}.</p>}
      </div>
    </section>
  );
}

function SettingsForm({ initial, onSaved }) {
  const { show: toast } = useToast();
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const memberCanSend = (f.sendRoles || []).includes("MEMBER");

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const { data } = await updateAssistantSettings({
        assistantName: f.assistantName,
        sendRoles: f.sendRoles,
        defaultVisibility: f.defaultVisibility,
        transcriptRetentionDays: Number(f.transcriptRetentionDays),
        generatedContentRetentionDays: Number(f.generatedContentRetentionDays),
        retainRawAudio: !!f.retainRawAudio,
        rawAudioRetentionDays: f.retainRawAudio ? Number(f.rawAudioRetentionDays) : 0,
        outputLanguage: f.outputLanguage,
      });
      setF(data); onSaved?.(data);
      toast("Settings saved", "success");
    } catch (err) { setError(apiErrorMessage(err, "Couldn't save the settings.")); }
    finally { setSaving(false); }
  };

  return (
    <form className="ma-card" onSubmit={save} aria-label="Assistant settings">
      <h2>Assistant settings</h2>

      <div className="ma-field">
        <label htmlFor="ps-name">Assistant name</label>
        <input id="ps-name" type="text" maxLength={60} value={f.assistantName || ""} onChange={(e) => set("assistantName", e.target.value)} />
        <span className="ma-hint">This is the name participants will see.</span>
      </div>

      <fieldset style={{ border: 0, padding: 0 }}>
        <legend className="ma-legend">Who can send the assistant</legend>
        <div className="ma-checks">
          <label><input type="checkbox" checked disabled /> Owners and admins (always)</label>
          <label><input type="checkbox" checked={memberCanSend}
            onChange={(e) => set("sendRoles", e.target.checked ? ["OWNER", "ADMIN", "MEMBER"] : ["OWNER", "ADMIN"])} /> Members</label>
        </div>
        <p className="ma-hint">Viewers can look but never send.</p>
      </fieldset>

      <div className="ma-field">
        <label htmlFor="ps-vis">Who can open a meeting's results by default</label>
        <select id="ps-vis" value={f.defaultVisibility} onChange={(e) => set("defaultVisibility", e.target.value)}>
          <option value="PRIVATE">Only the person who added it, people they share with, and admins</option>
          <option value="WORKSPACE">Everyone in the workspace</option>
        </select>
      </div>

      <div className="ma-field">
        <label htmlFor="ps-tr">Keep transcripts for (days)</label>
        <input id="ps-tr" type="number" min="1" max="3650" value={f.transcriptRetentionDays} onChange={(e) => set("transcriptRetentionDays", e.target.value)} />
      </div>
      <div className="ma-field">
        <label htmlFor="ps-gc">Keep summaries and minutes for (days)</label>
        <input id="ps-gc" type="number" min="1" max="3650" value={f.generatedContentRetentionDays} onChange={(e) => set("generatedContentRetentionDays", e.target.value)} />
      </div>

      <div className="ma-field">
        <label className="ma-switch"><input type="checkbox" checked={!!f.retainRawAudio} onChange={(e) => set("retainRawAudio", e.target.checked)} /> Keep raw audio</label>
        <span className="ma-hint">Off by default. Audio isn't collected by the current setup; this records your policy for when it is.</span>
        {f.retainRawAudio && (
          <>
            <label htmlFor="ps-ra">Keep raw audio for (days, up to 90)</label>
            <input id="ps-ra" type="number" min="1" max="90" value={f.rawAudioRetentionDays} onChange={(e) => set("rawAudioRetentionDays", e.target.value)} />
          </>
        )}
      </div>

      <div className="ma-field">
        <label htmlFor="ps-lang">Output language</label>
        <input id="ps-lang" type="text" value={f.outputLanguage || ""} onChange={(e) => set("outputLanguage", e.target.value)} />
        <span className="ma-hint">A language code such as en, es or pt-BR. The original transcript is always kept as spoken.</span>
      </div>

      <fieldset style={{ border: 0, padding: 0 }}>
        <legend className="ma-legend">Creating tasks and projects</legend>
        <div className="ma-checks">
          <label><input type="radio" checked readOnly /> Review before creating (default)</label>
          <label><input type="checkbox" disabled /> Create tasks automatically</label>
          <label><input type="checkbox" disabled /> Create projects automatically</label>
        </div>
        <p className="ma-hint">Automatic creation isn't available yet. Everything goes to review first.</p>
      </fieldset>

      {error && <p className="ma-error" role="alert">{error}</p>}
      <button type="submit" className="ma-btn primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
    </form>
  );
}

export default function MeetingPlatforms() {
  const { show: toast } = useToast();
  const { isAdmin, isOwner } = useRole();
  const allowed = !!(isAdmin || isOwner);
  const navigate = useNavigate();
  const [platforms, setPlatforms] = useState([]);
  const [settings, setSettings] = useState(null);
  const [caps, setCaps] = useState(null);
  const [google, setGoogle] = useState(null);

  const load = useCallback(async () => {
    try { setPlatforms((await getMeetingPlatforms()).data); }
    catch (e) { toast(apiErrorMessage(e, "Couldn't load meeting platforms."), "error"); }
    const [c, g] = await Promise.allSettled([getAssistantCapabilities(), getGoogleConnection()]);
    if (c.status === "fulfilled") setCaps(c.value.data);
    if (g.status === "fulfilled") setGoogle(g.value.data);
  }, [toast]);

  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    (async () => {
      await load();
      try {
        const r = await getAssistantSettings();
        if (live) setSettings(r.data);
      } catch (e) { if (live) toast(apiErrorMessage(e, "Couldn't load settings."), "error"); }
    })();
    return () => { live = false; };
  }, [allowed, load, toast]);

  if (!allowed) {
    return (
      <div>
        <PageHeader icon="🎙" title="Meeting Platforms" />
        <p className="ma-card" role="alert">Only workspace admins can manage meeting platforms.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader icon="🎙" title="Meeting Platforms"
        description="Choose which meeting platforms your team can use with the Meeting Assistant."
        action={<button className="ma-btn" onClick={() => navigate("/meeting-assistant")}>Open Meeting Assistant</button>} />
      <div className="ma-platforms">
        {platforms.map((p) => <PlatformCard key={p.provider} p={p} caps={caps} google={google} onChanged={load} />)}
      </div>
      {settings && <SettingsForm initial={settings} onSaved={setSettings} />}
    </div>
  );
}
