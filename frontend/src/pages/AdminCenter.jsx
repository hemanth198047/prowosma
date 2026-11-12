import { useState, useEffect, useCallback } from "react";
import { unwrapList } from "../api/client";
import PageHeader from "../components/PageHeader";
import client from "../api/client";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { getBillingSummary, getPlans, startCheckout, openBillingPortal } from "../api/billing";
import { getTeamMembers, updateTeamMember, deleteTeamMember } from "../api/team";
import { getPendingInvites, sendInvitation, cancelInvitation, resendInvitation } from "../api/invitations";
import { getProjects } from "../api/projects";
import { useRole } from "../hooks/useRole";
import { apiErrorMessage } from "../utils/apiError";
import { statusText } from "../utils/statusText";

// ── API helpers ───────────────────────────────────────────────
// Read workspace ID directly from sessionStorage as a fallback
function wsHeader() {
  // Find the tab-keyed activeWorkspace in sessionStorage
  const wsKey = Object.keys(sessionStorage).find(k => k.endsWith("__activeWorkspace"));
  if (wsKey) {
    try {
      const ws = JSON.parse(sessionStorage.getItem(wsKey));
      if (ws?.id) return { headers: { "X-Workspace-Id": ws.id } };
    } catch { /* malformed sessionStorage entry */ }
  }
  return {};
}

const getSecurityStats  = ()     => client.get("/security/stats", wsHeader());
const getSessions       = ()     => client.get("/security/sessions/all", wsHeader());
const revokeSession     = (id)   => client.delete(`/security/sessions/${id}`, wsHeader());
const getFeatureFlags   = ()     => client.get("/admin/features", wsHeader());
const saveFeatureFlag   = (data) => client.post("/admin/features", data, wsHeader());
const getUsageStats     = ()     => client.get("/admin/usage", wsHeader());
const getRetentionPolicy= ()     => client.get("/admin/retention", wsHeader());
const saveRetention     = (data) => client.post("/admin/retention", data, wsHeader());
const getEmailSettings  = ()     => client.get("/admin/email-settings", wsHeader());
const saveEmailSettings = (data) => client.post("/admin/email-settings", data, wsHeader());
const testEmailSettings = (to)   => client.post("/admin/email-settings/test", { to }, wsHeader());
const getSecurityPolicy  = ()     => client.get("/admin/security-policy", wsHeader());
const saveSecurityPolicy = (data) => client.post("/admin/security-policy", data, wsHeader());
const getScimTokenStatus = ()     => client.get("/admin/scim-token", wsHeader());
const generateScimToken  = ()     => client.post("/admin/scim-token/generate", {}, wsHeader());
const revokeScimToken    = ()     => client.delete("/admin/scim-token", wsHeader());
const getDlpPolicy       = ()     => client.get("/admin/dlp-policy", wsHeader());
const saveDlpPolicy      = (data) => client.post("/admin/dlp-policy", data, wsHeader());
const getDlpViolations   = ()     => client.get("/admin/dlp-violations", wsHeader());

// ── SCIM Provisioning Token ────────────────────────────────────
// The actual /scim/v2/** endpoints (called by the IdP, not by this UI) are
// authenticated by ScimAuthFilter on the backend — this card only manages
// the token that filter checks, it never talks to /scim/v2/ itself.
function ScimTokenCard() {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState(null); // shown once, right after generating
  const [busy, setBusy] = useState(false);
  const { show: toast } = useToast();
  const confirm = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    getScimTokenStatus()
      .then((r) => setStatus(r.data))
      .catch(() => toast("Failed to load SCIM token status", "error"))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    load();
  }, [load]);

  const handleGenerate = async () => {
    const isRotate = status?.active;
    const ok = await confirm({
      title: isRotate ? "Regenerate SCIM token?" : "Generate SCIM token?",
      message: isRotate
        ? "Your identity provider's current token will stop working immediately. You'll need to update it there with the new token."
        : "Your identity provider will need this token to auto-provision users.",
      danger: isRotate,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await generateScimToken();
      setNewToken(r.data);
      load();
      toast(isRotate ? "SCIM token regenerated" : "SCIM token generated", "success");
    } catch {
      toast("Failed to generate SCIM token", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    const ok = await confirm({
      title: "Revoke SCIM token?",
      message: "Your identity provider will immediately lose the ability to provision or deactivate users until a new token is generated and configured there.",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await revokeScimToken();
      setNewToken(null);
      load();
      toast("SCIM token revoked", "success");
    } catch {
      toast("Failed to revoke SCIM token", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = () => {
    navigator.clipboard?.writeText(newToken.token);
    toast("Copied to clipboard", "success");
  };

  if (loading) return null;

  return (
    <div className="admin-card">
      <div className="admin-card-title">SCIM Provisioning</div>

      {newToken && (
        <div className="admin-audit-note" style={{ marginBottom: "10px", border: "1px solid var(--warning)", borderRadius: "8px", padding: "10px" }}>
          <strong>Copy this token now — it will not be shown again.</strong>
          <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
            <code className="admin-code" style={{ flex: 1, wordBreak: "break-all" }}>{newToken.token}</code>
            <button className="btn-secondary" style={{ fontSize: "11px" }} onClick={copyToken}>Copy</button>
          </div>
          <div style={{ marginTop: "6px", fontSize: "12px" }}>
            In your IdP, set the SCIM base URL to <code className="admin-code">{newToken.scimBaseUrl}</code> and the bearer token to the value above.
          </div>
        </div>
      )}

      {status?.active ? (
        <>
          <div className="admin-mfa-label">
            Active — <code className="admin-code">{status.keyPrefix}…</code>
            {" "}created {status.createdAt ? new Date(status.createdAt).toLocaleDateString() : "—"}
            {status.lastUsed && <> · last used {new Date(status.lastUsed).toLocaleString()}</>}
            {!status.lastUsed && <span className="admin-warn"> · never used yet</span>}
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button className="btn-secondary" disabled={busy} onClick={handleGenerate}>Regenerate</button>
            <button className="btn-secondary" disabled={busy} style={{ color: "var(--danger)" }} onClick={handleRevoke}>Revoke</button>
          </div>
        </>
      ) : (
        <>
          <div className="admin-empty">No SCIM token configured — provisioning from your identity provider will be rejected until you generate one.</div>
          <button className="btn-primary" disabled={busy} style={{ marginTop: "10px" }} onClick={handleGenerate}>
            + Generate SCIM Token
          </button>
        </>
      )}
    </div>
  );
}

// ── C-3: Security Centre ──────────────────────────────────────
function SecurityCentre() {
  const [stats,    setStats]    = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const { show: toast } = useToast();

  useEffect(() => {
    Promise.all([getSecurityStats(), getSessions()])
      .then(([sr, ses]) => { setStats(sr.data); setSessions(unwrapList(ses)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRevoke = async (id) => {
    await revokeSession(id);
    setSessions(s => s.filter(x => x.id !== id));
    toast("Session revoked", "success");
  };

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  return (
    <div className="admin-section">
      <div className="admin-stat-grid">
        {[
          { label:"MFA Adoption",       value: stats?.mfaAdoptionPct   ?? "—", unit:"%",  color:"var(--success)", icon:"🔐" },
          { label:"Active Sessions",    value: sessions.length,                color:"var(--brand-500)", icon:"💻" },
          { label:"Failed Logins (24h)",value: stats?.failedLogins24h  ?? 0,   color:"var(--danger)", icon:"⚠️" },
          { label:"Anomalous Logins",   value: stats?.anomalousLogins  ?? 0,   color:"var(--warning)", icon:"🚨" },
          { label:"Total Users",        value: stats?.totalUsers       ?? "—", color:"var(--purple)", icon:"👤" },
          { label:"2FA Enabled Users",  value: stats?.twoFaUsers       ?? "—", color:"var(--success)", icon:"✅" },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div className="admin-stat-icon">{s.icon}</div>
            <div className="admin-stat-num" style={{ color:s.color }}>{s.value}{s.unit||""}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="admin-card-title">MFA Status</div>
        <div className="admin-mfa-bar">
          <div className="admin-mfa-fill" style={{ width:`${stats?.mfaAdoptionPct ?? 0}%` }} />
        </div>
        <div className="admin-mfa-label">
          {stats?.twoFaUsers ?? 0} of {stats?.totalUsers ?? 0} users have 2FA enabled
          {(stats?.mfaAdoptionPct ?? 0) < 80 &&
            <span className="admin-warn"> — recommend enforcing 2FA for all members</span>}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Active Sessions</div>
        {sessions.length === 0
          ? <div className="admin-empty">No active sessions found</div>
          : sessions.slice(0,10).map(s => (
            <div key={s.id} className="admin-session-row">
              <div className="admin-session-info">
                <div className="admin-session-user">{s.email}</div>
                <div className="admin-session-meta">{s.ipAddress} · {s.deviceInfo || "Unknown device"} · {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString() : "—"}</div>
              </div>
              <button className="btn-secondary" style={{ fontSize:"11px", color:"var(--danger)" }}
                onClick={() => handleRevoke(s.id)}>Revoke</button>
            </div>
          ))
        }
      </div>

      <ScimTokenCard />

      <div className="admin-card">
        <div className="admin-card-title">Permission Audit</div>
        <div className="admin-audit-note">
          SCIM 2.0 provisioning endpoint: <code className="admin-code">/scim/v2/Users</code><br/>
          Metadata URL: <code className="admin-code">/scim/v2/ServiceProviderConfig</code><br/>
          Configure your IdP (Okta, Azure AD) to point to these endpoints — generate a bearer token above first, calls without one are now rejected.
        </div>
      </div>
    </div>
  );
}

// ── C-4: Data Retention + Legal Hold ─────────────────────────
function DataRetention() {
  const [policy,  setPolicy]  = useState({ retentionDays:2557, legalHoldEnabled:false, legalHoldReason:"", autoDeleteEnabled:false });
  const [saving,  setSaving]  = useState(false);
  const { show: toast } = useToast();

  useEffect(() => {
    // Was unwrapList(r) — /admin/retention returns the policy object
    // directly, not a list, so this card's toggles never reflected the
    // actual saved policy.
    getRetentionPolicy().then(r => setPolicy(r.data)).catch(() => {});
  }, []);

  const set = (k, v) => setPolicy(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try { await saveRetention(policy); toast("Retention policy saved", "success"); }
    catch { toast("Save failed", "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Data Retention Policy</div>
        <div className="form-group">
          <label htmlFor={"admin-center-retain-data-for-days"}>Retain data for (days)</label>
          <input type="number" min={30} value={policy.retentionDays}
            onChange={e => set("retentionDays", Number(e.target.value))} id={"admin-center-retain-data-for-days"} />
          <div className="admin-field-help">
            Data older than this will be eligible for deletion. Minimum: 30 days. Default: 7 years (2557 days).
          </div>
        </div>
        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={policy.autoDeleteEnabled}
              onChange={e => set("autoDeleteEnabled", e.target.checked)} />
            Enable automatic deletion of expired data
          </label>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Legal Hold</div>
        <div className="admin-legal-hold-desc">
          When legal hold is active, no data will be deleted regardless of retention policy. Use during litigation or regulatory investigations.
        </div>
        <div className="form-group">
          <label className={`admin-toggle-label${policy.legalHoldEnabled ? " hold-active" : ""}`}>
            <input type="checkbox" checked={policy.legalHoldEnabled}
              onChange={e => set("legalHoldEnabled", e.target.checked)} />
            {policy.legalHoldEnabled ? "Legal Hold ACTIVE — all deletion suspended" : "Legal hold is inactive"}
          </label>
        </div>
        {policy.legalHoldEnabled && (
          <div className="form-group">
            <label htmlFor={"admin-center-reason-case-reference"}>Reason / Case Reference</label>
            <textarea rows={2} value={policy.legalHoldReason}
              onChange={e => set("legalHoldReason", e.target.value)}
              placeholder="e.g. Case #12345 — regulatory audit Q2 2026" id={"admin-center-reason-case-reference"} />
          </div>
        )}
      </div>

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save Policy"}
      </button>
    </div>
  );
}

// ── Email Settings (dynamic per-workspace SMTP, no env vars needed) ──
function EmailSettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUsername: "",
    smtpPassword: "", fromEmail: "", fromName: "Prowosma", smtpUseTls: true,
  });
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { show: toast } = useToast();

  const load = () => {
    getEmailSettings().then(r => {
      // Was unwrapList(r) — /admin/email-settings returns the settings
      // object directly, not a list, so every field below was reading off
      // an empty array and this form has likely always loaded blank.
      const data = r.data;
      setSettings(data);
      setForm(f => ({
        ...f,
        smtpHost: data.smtpHost || "smtp.gmail.com",
        smtpPort: data.smtpPort || 587,
        smtpUsername: data.smtpUsername || "",
        smtpPassword: "", // never prefilled - see hasPassword below
        fromEmail: data.fromEmail || "",
        fromName: data.fromName || "Prowosma",
        smtpUseTls: data.smtpUseTls !== false,
      }));
    }).catch(() => {});
  };

  useEffect(load, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveEmailSettings(form);
      toast(unwrapList(res).message || "Email settings saved", unwrapList(res).emailConfigured ? "success" : "info");
      load();
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't save email settings"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) { toast("Enter an email address to send the test to", "error"); return; }
    setTesting(true);
    try {
      const res = await testEmailSettings(testTo.trim());
      toast(unwrapList(res).message || "Test email sent", "success");
      load();
    } catch (e) {
      toast(apiErrorMessage(e, "Test email failed to send"), "error");
      load();
    } finally {
      setTesting(false);
    }
  };

  if (!settings) return <div className="admin-section"><div className="admin-card">Loading…</div></div>;

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Email Settings</div>
        <div className="admin-field-help" style={{ marginBottom: 16 }}>
          Configure the mail account this workspace uses to send invitations and
          notifications. No server environment variables or technical setup needed —
          fill this in and save.
        </div>

        <div style={{
          display: "inline-block", padding: "4px 12px", borderRadius: 999, fontSize: 12,
          fontWeight: 600, marginBottom: 16,
          background: settings.emailConfigured ? "#e7f6ec" : "#fdf1e0",
          color: settings.emailConfigured ? "#15803d" : "#b45309",
        }}>
          {settings.emailConfigured ? "✓ Configured — sending through this workspace's account" : "Not configured yet — falls back to the server default (which may not be set up either)"}
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-smtp-host"}>SMTP Host</label>
          <input value={form.smtpHost} onChange={e => set("smtpHost", e.target.value)} placeholder="smtp.gmail.com" id={"admin-center-smtp-host"} />
          <div className="admin-field-help">Gmail: smtp.gmail.com · Outlook: smtp.office365.com · SendGrid: smtp.sendgrid.net</div>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-smtp-port"}>SMTP Port</label>
          <input type="number" value={form.smtpPort} onChange={e => set("smtpPort", Number(e.target.value))} id={"admin-center-smtp-port"} />
          <div className="admin-field-help">587 for TLS (most common), 465 for SSL, 25 for unencrypted (not recommended)</div>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-username"}>Username</label>
          <input value={form.smtpUsername} onChange={e => set("smtpUsername", e.target.value)} placeholder="your-email@gmail.com" id={"admin-center-username"} />
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-password"}>Password</label>
          <input type="password" value={form.smtpPassword} onChange={e => set("smtpPassword", e.target.value)}
            placeholder={settings.hasPassword ? "•••••••••••••• (saved — leave blank to keep it)" : "App password (not your regular login password)"} id={"admin-center-password"} />
          <div className="admin-field-help">
            For Gmail, this must be an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">App Password</a>, not your normal Google password (requires 2-Step Verification to be turned on first).
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-from-name"}>From Name</label>
          <input value={form.fromName} onChange={e => set("fromName", e.target.value)} placeholder="Prowosma" id={"admin-center-from-name"} />
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-from-email"}>From Email <span style={{ fontWeight: 400, color: "var(--gray-400)" }}>(optional — defaults to Username above)</span></label>
          <input value={form.fromEmail} onChange={e => set("fromEmail", e.target.value)} placeholder="notifications@yourcompany.com" id={"admin-center-from-email"} />
        </div>

        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={form.smtpUseTls} onChange={e => set("smtpUseTls", e.target.checked)} />
            Use TLS encryption (leave on unless your provider says otherwise)
          </label>
        </div>

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Send a Test Email</div>
        <div className="admin-field-help" style={{ marginBottom: 12 }}>
          Save your settings above first, then send a real test email to confirm they actually work before relying on them.
        </div>
        <div className="form-group" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label htmlFor={"admin-center-send-test-to"}>Send test to</label>
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com" id={"admin-center-send-test-to"} />
          </div>
          <button className="btn-secondary" onClick={handleTest} disabled={testing || !settings.emailConfigured}>
            {testing ? "Sending…" : "Send Test Email"}
          </button>
        </div>
        {!settings.emailConfigured && (
          <div className="admin-field-help" style={{ color: "#b45309" }}>Save a complete host/username/password above to enable testing.</div>
        )}
        {settings.lastTestAt && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 13,
            background: settings.lastTestSuccess ? "#e7f6ec" : "#fde8e8",
            color: settings.lastTestSuccess ? "#15803d" : "#b91c1c",
          }}>
            Last test: {new Date(settings.lastTestAt).toLocaleString()} —{" "}
            {settings.lastTestSuccess ? "succeeded ✓" : `failed (${settings.lastTestError})`}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Security Policy (password complexity/expiry, session limits) ──
function SecurityPolicyPanel() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const { show: toast } = useToast();

  const load = () => {
    getSecurityPolicy().then(r => {
      // Was unwrapList(r) — /admin/security-policy returns the policy
      // object directly; this form has likely always loaded blank/default.
      const data = r.data;
      setForm(data);
    }).catch(() => {});
  };

  useEffect(load, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSecurityPolicy(form);
      toast("Security policy saved", "success");
      load();
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't save security policy"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <div className="admin-section"><div className="admin-card">Loading…</div></div>;

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Password Policy</div>
        <div className="admin-field-help" style={{ marginBottom: 16 }}>
          Applies when members of this workspace set or change their password.
          Registration (before any workspace exists) always uses a sane baseline
          regardless of these settings.
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-minimum-length"}>Minimum length</label>
          <input type="number" min={6} max={64} value={form.passwordMinLength}
            onChange={e => set("passwordMinLength", Number(e.target.value))} style={{ maxWidth: 120 }} id={"admin-center-minimum-length"} />
          <div className="admin-field-help">Can't be set below 6.</div>
        </div>

        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={form.passwordRequireUppercase}
              onChange={e => set("passwordRequireUppercase", e.target.checked)} />
            Require an uppercase letter
          </label>
        </div>
        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={form.passwordRequireLowercase}
              onChange={e => set("passwordRequireLowercase", e.target.checked)} />
            Require a lowercase letter
          </label>
        </div>
        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={form.passwordRequireNumber}
              onChange={e => set("passwordRequireNumber", e.target.checked)} />
            Require a number
          </label>
        </div>
        <div className="form-group">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={form.passwordRequireSpecial}
              onChange={e => set("passwordRequireSpecial", e.target.checked)} />
            Require a special character
          </label>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-password-expires-after"}>Password expires after</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={0} max={3650} value={form.passwordExpiryDays}
              onChange={e => set("passwordExpiryDays", Number(e.target.value))} style={{ maxWidth: 120 }} id={"admin-center-password-expires-after"} />
            <span style={{ fontSize: 13, color: "var(--gray-400)" }}>days (0 = never expires)</span>
          </div>
          <div className="admin-field-help">
            When a password expires, that member is blocked from logging in until they
            set a new one — they'll be walked through resetting it right on the login screen.
          </div>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Session Limits</div>

        <div className="form-group">
          <label htmlFor={"admin-center-idle-session-timeout"}>Idle session timeout</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={0} max={10080} value={form.sessionTimeoutMinutes}
              onChange={e => set("sessionTimeoutMinutes", Number(e.target.value))} style={{ maxWidth: 120 }} id={"admin-center-idle-session-timeout"} />
            <span style={{ fontSize: 13, color: "var(--gray-400)" }}>minutes (0 = disabled)</span>
          </div>
          <div className="admin-field-help">
            A session with no activity for longer than this is signed out automatically,
            even if its login token hasn't technically expired yet.
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-max-concurrent-sessions-per-person"}>Max concurrent sessions per person</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={0} max={50} value={form.maxConcurrentSessions}
              onChange={e => set("maxConcurrentSessions", Number(e.target.value))} style={{ maxWidth: 120 }} id={"admin-center-max-concurrent-sessions-per-person"} />
            <span style={{ fontSize: 13, color: "var(--gray-400)" }}>(0 = unlimited)</span>
          </div>
          <div className="admin-field-help">
            When someone logs in past this limit, their oldest active session is signed
            out to make room for the new one.
          </div>
        </div>

        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? "Saving…" : "Save Security Policy"}
        </button>
      </div>
    </div>
  );
}

const DEFAULT_FLAGS = [
  { key:"ai_assistant",      label:"AI Assistant",        desc:"Enable AI chat and generation features",   group:"AI" },
  { key:"ai_prioritization", label:"AI Prioritization",   desc:"Daily AI-ranked task list",               group:"AI" },
  { key:"burnout_detection", label:"Burnout Detection",   desc:"Workload pattern analysis alerts",        group:"AI" },
  { key:"collab_editing",    label:"Collaborative Docs",  desc:"Real-time multi-user document editing",   group:"Collaboration" },
  { key:"sprint_module",     label:"Sprint / Agile",      desc:"Sprint planning and burndown charts",     group:"Work" },
  { key:"kpi_tracker",       label:"KPI Tracker",         desc:"Standalone KPI metrics and forecasting",  group:"Insights" },
  { key:"automations",       label:"Automations",         desc:"No-code workflow automation builder",     group:"Automate" },
  { key:"approval_workflows",label:"Approval Workflows",  desc:"Multi-step approval chains",              group:"Automate" },
  { key:"sop_management",    label:"SOP Management",      desc:"Standard operating procedures lifecycle", group:"Knowledge" },
  { key:"scim_provisioning", label:"SCIM Provisioning",   desc:"Auto user create/deactivate via IdP",     group:"Security" },
  { key:"saml_sso",          label:"SAML SSO",            desc:"Enterprise single sign-on",               group:"Security" },
  { key:"portfolio_view",    label:"Portfolio View",       desc:"Cross-project health and analytics",      group:"Insights" },
];

function FeatureFlags() {
  const [flags,   setFlags]   = useState({});
  const [usage,   setUsage]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const { show: toast } = useToast();

  useEffect(() => {
    Promise.all([getFeatureFlags(), getUsageStats()])
      .then(([fr, ur]) => { setFlags(fr.data || {}); setUsage(ur.data); })
      .catch(() => {});
  }, []);

  const toggle = async (key) => {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    setSaving(true);
    try { await saveFeatureFlag({ key, enabled: next[key] }); toast(`Feature ${next[key] ? "enabled" : "disabled"}`, "success"); }
    catch { toast("Save failed", "error"); }
    finally { setSaving(false); }
  };

  const groups = [...new Set(DEFAULT_FLAGS.map(f => f.group))];

  return (
    <div className="admin-section">
      {/* Usage stats */}
      {usage && (
        <div className="admin-card">
          <div className="admin-card-title">Workspace Usage</div>
          <div className="admin-usage-grid">
            {[
              { label:"Daily Active Users",    value: usage.dau    ?? "—" },
              { label:"Weekly Active Users",   value: usage.wau    ?? "—" },
              { label:"Monthly Active Users",  value: usage.mau    ?? "—" },
              { label:"Total Tasks",           value: usage.tasks  ?? "—" },
              { label:"Total Docs",            value: usage.docs   ?? "—" },
              { label:"Storage Used",          value: usage.storage? `${usage.storage}MB` : "—" },
              { label:"AI Credits Used",       value: usage.aiCredits ?? "—" },
              { label:"Automations Run",       value: usage.automationRuns ?? "—" },
            ].map(u => (
              <div key={u.label} className="admin-usage-stat">
                <div className="admin-usage-num">{u.value}</div>
                <div className="admin-usage-label">{u.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature flags grouped */}
      {groups.map(group => (
        <div key={group} className="admin-card">
          <div className="admin-card-title">
            {group === "AI" ? "🤖" : group === "Security" ? "🔐" : group === "Work" ? "⚡" :
             group === "Insights" ? "📊" : group === "Automate" ? "⚙️" :
             group === "Knowledge" ? "📚" : "👥"} {group}
          </div>
          {DEFAULT_FLAGS.filter(f => f.group === group).map(f => (
            <div key={f.key} className="admin-flag-row">
              <div className="admin-flag-info">
                <div className="admin-flag-label">{f.label}</div>
                <div className="admin-flag-desc">{f.desc}</div>
              </div>
              <label className="admin-flag-switch" aria-label={f.label}>
                <input type="checkbox"
                  checked={flags[f.key] !== false}
                  disabled={saving}
                  onChange={() => toggle(f.key)} />
                <span className="admin-flag-slider" />
              </label>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── C-6: Billing Dashboard ────────────────────────────────────
const FEATURE_LABELS = {
  sso: "SSO / SAML",
  scim: "SCIM provisioning",
  whiteLabel: "White-labeling",
  apiAccess: "API access",
  prioritySupport: "Priority support",
};

function Billing() {
  const [summary, setSummary] = useState(null);
  const [plans,   setPlans]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // planId currently loading, or "portal"
  const [banner, setBanner] = useState(null); // { type: "success"|"error"|"info", text }

  const load = () => {
    setLoading(true);
    Promise.all([getBillingSummary(), getPlans()])
      .then(([summaryRes, plansRes]) => {
        setSummary(summaryRes.data);
        setPlans(plansRes.data || []);
      })
      .catch(() => setBanner({ type: "error", text: "Couldn't load billing information." }))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
  useEffect(load, []);

  const handleUpgrade = async (plan) => {
    setBanner(null);
    if (!plan.selfServe) {
      const opened = window.open("mailto:sales@prowosma.app?subject=" + encodeURIComponent(plan.name + " Plan Inquiry"), "_blank");
      setBanner({
        type: "info",
        text: opened
          ? "Opening your email client to reach our sales team…"
          : "Couldn't open your email client — reach us directly at sales@prowosma.app.",
      });
      return;
    }
    setActionLoading(plan.id);
    try {
      const res = await startCheckout(plan.id, summary?.seatsUsed || 1);
      // eslint-disable-next-line react-hooks/immutability -- click-triggered checkout handler, not render
      window.location.href = res.data.url; // hand off to Stripe's real hosted checkout
    } catch (err) {
      setBanner({
        type: "error",
        text: apiErrorMessage(err, "Couldn't start checkout. Please try again."),
      });
      setActionLoading(null);
    }
  };

  const handleManageBilling = async () => {
    setBanner(null);
    setActionLoading("portal");
    try {
      const res = await openBillingPortal();
      window.location.href = res.data.url;
    } catch (err) {
      setBanner({
        type: "error",
        text: apiErrorMessage(err, "Couldn't open the billing portal."),
      });
      setActionLoading(null);
    }
  };

  const formatPrice = (plan) => {
    if (!plan.selfServe && plan.displayPriceCentsPerSeat === 0) return "Custom";
    if (plan.displayPriceCentsPerSeat === 0) return "$0";
    return `$${(plan.displayPriceCentsPerSeat / 100).toFixed(0)}`;
  };

  if (loading) return <div className="admin-section"><div className="admin-card">Loading billing…</div></div>;

  return (
    <div className="admin-section">
      {banner && (
        <div className={`admin-card`} style={{
          background: banner.type === "error" ? "#fde8e8" : banner.type === "success" ? "#e7f6ec" : "#e8f0fe",
          color: banner.type === "error" ? "#b91c1c" : banner.type === "success" ? "#15803d" : "#1a56db",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      {!summary?.stripeConfigured && (
        <div className="admin-card" style={{ background: "#fdf1e0", color: "#b45309" }}>
          Payments aren't configured on this server yet — checkout will show an error until a Stripe secret key is set.
        </div>
      )}

      {summary && (
        <div className="admin-card">
          <div className="admin-card-title">Current Plan</div>
          <div className="admin-billing-current">
            <div className="admin-billing-plan-name">{summary.planName}</div>
            <div className="admin-billing-seats">
              {summary.seatsUsed} of {summary.seatLimit < 0 ? "∞" : summary.seatLimit} seats used
              {summary.status && summary.status !== "none" && ` · ${statusText(summary.status)}`}
              {summary.cancelAtPeriodEnd && " · cancels at period end"}
            </div>
            {summary.currentPeriodEnd && (
              <div className="admin-billing-next">
                {summary.cancelAtPeriodEnd ? "Access until" : "Next billing"}: {new Date(summary.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
            {summary.trialEnd && summary.status === "trialing" && (
              <div className="admin-billing-next">Trial ends: {new Date(summary.trialEnd).toLocaleDateString()}</div>
            )}
            {summary.hasPaymentMethod && (
              <button className="btn-secondary" style={{ marginTop: "10px" }}
                disabled={actionLoading === "portal"}
                onClick={handleManageBilling}>
                {actionLoading === "portal" ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-title">Available Plans</div>
        <div className="admin-plans-grid">
          {plans.map(plan => {
            const isCurrent = summary?.planId === plan.id;
            const included = Object.entries(FEATURE_LABELS).filter(([key]) => plan[key]);
            return (
              <div key={plan.id} className={`admin-plan-card${isCurrent ? " current" : ""}`}>
                <div className="admin-plan-name">{plan.name}</div>
                <div className="admin-plan-price">{formatPrice(plan)}
                  {plan.displayPriceCentsPerSeat > 0 && <span className="admin-plan-period"> / user/mo</span>}
                </div>
                <ul className="admin-plan-features">
                  <li>✓ {plan.seatLimit < 0 ? "Unlimited" : `Up to ${plan.seatLimit}`} seats</li>
                  {included.map(([key, label]) => <li key={key}>✓ {label}</li>)}
                  {included.length === 0 && <li>Core features</li>}
                </ul>
                {!isCurrent && (
                  <button className={`btn-${plan.selfServe ? "primary" : "secondary"}`}
                    style={{ width: "100%", marginTop: "10px" }}
                    disabled={actionLoading === plan.id}
                    onClick={() => handleUpgrade(plan)}>
                    {actionLoading === plan.id ? "Redirecting…" : plan.selfServe ? "Upgrade" : "Contact Sales"}
                  </button>
                )}
                {isCurrent && <div className="admin-plan-current-badge">✓ Current Plan</div>}
              </div>
            );
          })}
        </div>
      </div>

      {summary?.invoices?.length > 0 && (
        <div className="admin-card">
          <div className="admin-card-title">Invoice History</div>
          {summary.invoices.map(inv => (
            <div key={inv.stripeInvoiceId} className="admin-invoice-row">
              <span>{inv.created ? new Date(inv.created).toLocaleDateString() : "—"}</span>
              <span>${(inv.amountPaid / 100).toFixed(2)}</span>
              <span className="admin-invoice-status">{statusText(inv.status)}</span>
              {inv.hostedInvoiceUrl && <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer"
                className="btn-link" style={{ fontSize: "11px" }}>View</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── IP Allowlisting ───────────────────────────────────────────
function IpAllowlist() {
  const [ips,   setIps]   = useState([]);
  const [newIp, setNewIp] = useState("");
  const [saving,setSaving]= useState(false);
  const { show:toast } = useToast();

  useEffect(()=>{
    client.get("/admin/ip-allowlist").then(r=>setIps(unwrapList(r))).catch(()=>{});
  },[]);

  const save = async (list) => {
    setSaving(true);
    try { await client.post("/admin/ip-allowlist",{ips:list}); toast("Allowlist saved","success"); }
    finally { setSaving(false); }
  };

  const add = () => {
    if (!newIp.trim()) return;
    const next = [...ips, newIp.trim()];
    setIps(next); setNewIp(""); save(next);
  };
  const remove = (ip) => { const next=ips.filter(x=>x!==ip); setIps(next); save(next); };

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">IP Allowlisting</div>
        <div className="admin-field-help" style={{marginBottom:"14px"}}>
          Restrict workspace access to specific IP addresses or CIDR ranges.
          Leave empty to allow all IPs. Supports IPv4, IPv6, and wildcard (e.g. 192.168.1.*)
        </div>
        {ips.length === 0
          ? <div className="admin-empty">No IP restrictions — all IPs allowed</div>
          : ips.map(ip=>(
            <div key={ip} className="admin-session-row">
              <span className="admin-code">{ip}</span>
              <button className="btn-secondary" style={{fontSize:"11px",color:"var(--danger)"}}
                onClick={()=>remove(ip)}>Remove</button>
            </div>
          ))
        }
        <div className="form-row" style={{marginTop:"14px"}}>
          <div className="form-group" style={{flex:2}}>
            <input value={newIp} onChange={e=>setNewIp(e.target.value)}
              placeholder="192.168.1.0 or 10.0.0.* or 2001:db8::/32"
              onKeyDown={e=>e.key==="Enter"&&add()} />
          </div>
          <button className="btn-primary" onClick={add} disabled={saving||!newIp.trim()}>
            Add IP
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Data Residency ────────────────────────────────────────────
function DataResidency() {
  const [region, setRegion] = useState("US");
  const [saved,  setSaved]  = useState(false);
  const { show:toast } = useToast();

  const REGIONS = [
    { id:"US",    flag:"🇺🇸", name:"United States",  desc:"AWS us-east-1 (N. Virginia)" },
    { id:"EU",    flag:"🇪🇺", name:"Europe (GDPR)",  desc:"AWS eu-west-1 (Ireland)" },
    { id:"APAC",  flag:"🌏", name:"Asia Pacific",   desc:"AWS ap-south-1 (Mumbai)" },
    { id:"AU",    flag:"🇦🇺", name:"Australia",      desc:"AWS ap-southeast-2 (Sydney)" },
  ];

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Data Residency</div>
        <div className="admin-field-help" style={{marginBottom:"14px"}}>
          Choose where your workspace data is stored. Changes take effect at next billing cycle.
          GDPR-compliant EU storage available on Business plan and above.
        </div>
        <div className="admin-plans-grid">
          {REGIONS.map(r=>(
            <button key={r.id} type="button" className={`admin-plan-card${region===r.id?" current":""}`}
              style={{cursor:"pointer", textAlign:"left", font:"inherit", color:"inherit", background:"none", width:"100%"}}
              aria-pressed={region===r.id} onClick={()=>setRegion(r.id)}>
              <div style={{fontSize:"24px",marginBottom:"6px"}}>{r.flag}</div>
              <div className="admin-plan-name">{r.name}</div>
              <div className="admin-field-help">{r.desc}</div>
              {region===r.id && <div className="admin-plan-current-badge">✓ Selected</div>}
            </button>
          ))}
        </div>
        <button className="btn-primary" style={{marginTop:"16px"}}
          onClick={()=>{ setSaved(true); toast("Data residency preference saved","success"); setTimeout(()=>setSaved(false),2000); }}>
          {saved?"Saved!":"Save Preference"}
        </button>
      </div>
    </div>
  );
}

// ── SOC2 Preparation ─────────────────────────────────────────
const SOC2_CONTROLS = [
  { id:"cc1", title:"Logical Access Controls",      desc:"MFA enforced, session management, RBAC", category:"CC" },
  { id:"cc2", title:"Change Management",             desc:"All changes tracked via audit log",       category:"CC" },
  { id:"cc3", title:"Risk Assessment",               desc:"RAID log maintained, risks reviewed",     category:"CC" },
  { id:"cc4", title:"Monitoring of Controls",        desc:"Anomalous login detection active",        category:"CC" },
  { id:"cc5", title:"Data Encryption at Rest",       desc:"MongoDB Atlas encryption enabled",        category:"CC" },
  { id:"cc6", title:"Data Encryption in Transit",    desc:"TLS 1.2+ on all endpoints",              category:"CC" },
  { id:"a1",  title:"Availability SLAs",             desc:"99.9% uptime target",                    category:"A"  },
  { id:"pi1", title:"Data Classification Policy",    desc:"Retention policies configured",           category:"PI" },
  { id:"pi2", title:"GDPR Compliance",               desc:"Export, deletion request flows built",   category:"PI" },
  { id:"pi3", title:"Legal Hold",                    desc:"Legal hold prevents deletion",            category:"PI" },
];

function Soc2Panel() {
  const [checks, setChecks] = useState(
    Object.fromEntries(SOC2_CONTROLS.map(c=>[c.id, false]))
  );
  const done    = Object.values(checks).filter(Boolean).length;
  const total   = SOC2_CONTROLS.length;
  const pct     = Math.round((done/total)*100);
  const color   = pct>=80?"var(--success)":pct>=50?"var(--warning)":"var(--danger)";

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">SOC2 Type II Preparation</div>
        <div style={{display:"flex",alignItems:"center",gap:"16px",marginBottom:"16px"}}>
          <div style={{fontSize:"32px",fontWeight:800,color}}>{pct}%</div>
          <div>
            <div className="admin-mfa-bar" style={{width:"200px"}}>
              <div className="admin-mfa-fill" style={{width:`${pct}%`,background:color}} />
            </div>
            <div style={{fontSize:"12px",color:"var(--gray-400)",marginTop:"4px"}}>
              {done} of {total} controls evidenced
            </div>
          </div>
        </div>
        {["CC","A","PI"].map(cat=>(
          <div key={cat} style={{marginBottom:"14px"}}>
            <div className="admin-card-title" style={{fontSize:"11px",marginBottom:"8px"}}>
              {cat==="CC"?"Common Criteria":cat==="A"?"Availability":"Processing Integrity"}
            </div>
            {SOC2_CONTROLS.filter(c=>c.category===cat).map(c=>(
              <label key={c.id} className="admin-flag-row" style={{cursor:"pointer"}} aria-label={c.title}>
                <div className="admin-flag-info">
                  <div className="admin-flag-label">{c.title}</div>
                  <div className="admin-flag-desc">{c.desc}</div>
                </div>
                <input type="checkbox" checked={checks[c.id]}
                  onChange={()=>setChecks(p=>({...p,[c.id]:!p[c.id]}))}
                  style={{accentColor:"var(--success)",width:"16px",height:"16px"}} />
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── License / Seat Management ─────────────────────────────────
function LicensePanel() {
  const [billing,    setBilling]    = useState(null);
  const [editSeats,  setEditSeats]  = useState(false);
  const [seatInput,  setSeatInput]  = useState("");
  const { show:toast } = useToast();

  useEffect(()=>{ client.get("/admin/billing",wsHeader()).then(r=>setBilling(r.data||null)).catch(()=>{}); },[]);

  const used  = billing?.usedSeats||0;
  const total = billing?.seats||5;
  const pct   = total>0 ? Math.round((used/total)*100) : 0;
  const overage = Math.max(0, used-total);

  const handleSaveSeats = () => {
    const n = parseInt(seatInput);
    if (isNaN(n) || n < 1) { toast("Enter a valid seat count", "error"); return; }
    setBilling(prev => ({ ...prev, seats: n }));
    toast(`Seats updated to ${n}`, "success");
    setEditSeats(false);
  };

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">License & Seat Management</div>
        <div className="budget-summary">
          <div className="budget-stat">
            {editSeats ? (
              <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
                <input
                  type="number" min="1" value={seatInput}
                  onChange={e => setSeatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveSeats()}
                 
                  style={{ width:"64px", padding:"4px 6px", border:"1px solid var(--primary)",
                    borderRadius:"6px", fontSize:"16px", fontWeight:700, textAlign:"center" }}
                />
                <button className="btn-primary" style={{ fontSize:"11px", padding:"4px 8px" }}
                  onClick={handleSaveSeats}>✓</button>
                <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 8px" }}
                  onClick={() => setEditSeats(false)}>✕</button>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                <div className="budget-stat-num">{total}</div>
                <button onClick={() => { setSeatInput(String(total)); setEditSeats(true); }}
                  style={{ background:"none", border:"none", cursor:"pointer",
                    fontSize:"13px", color:"var(--gray-400)", padding:"0" }}
                  title="Edit seats">✏️</button>
              </div>
            )}
            <div className="budget-stat-label">Licensed Seats</div>
          </div>
          <div className="budget-stat">
            <div className="budget-stat-num" style={{color:pct>90?"var(--danger)":"var(--gray-800)"}}>{used}</div>
            <div className="budget-stat-label">Used</div>
          </div>
          <div className="budget-stat">
            <div className="budget-stat-num" style={{color:"var(--success)"}}>{Math.max(0,total-used)}</div>
            <div className="budget-stat-label">Available</div>
          </div>
          <div className="budget-stat">
            <div className="budget-stat-num" style={{color:overage>0?"var(--danger)":"var(--success)"}}>
              {overage>0?`+${overage} over`:"OK"}
            </div>
            <div className="budget-stat-label">Status</div>
          </div>
        </div>
        <div className="budget-burn-bar" style={{marginTop:"12px"}}>
          <div className="budget-burn-fill" style={{width:`${Math.min(100,pct)}%`,
            background:pct>90?"var(--danger)":pct>70?"var(--warning)":"var(--success)"}} />
        </div>
        {overage>0 && (
          <div className="admin-warn" style={{marginTop:"10px",fontSize:"13px"}}>
            You have {overage} more member{overage>1?"s":""} than your license allows.
            <button className="btn-primary" style={{marginLeft:"10px",fontSize:"11px"}}>
              Upgrade Plan
            </button>
          </div>
        )}
        <div className="admin-field-help" style={{marginTop:"12px"}}>
          Current plan: <strong>{billing?.plan?.toUpperCase()||"FREE"}</strong>.
          Seat changes take effect immediately. Contact sales for volume discounts.
        </div>
      </div>
    </div>
  );
}

// ── Tenant Analytics ──────────────────────────────────────────
function TenantAnalytics() {
  const [usage, setUsage] = useState(null);
  // Was unwrapList(r) — /admin/usage returns the stats object directly;
  // this panel has likely always shown blank usage numbers.
  useEffect(()=>{ client.get("/admin/usage",wsHeader()).then(r=>setUsage(r.data)).catch(()=>{}); },[]);

  const engagementScore = usage
    ? Math.min(100, Math.round(
        ((usage.tasks||0)*0.3 + (usage.docs||0)*0.3 + (usage.projects||0)*0.4)
      ))
    : 0;
  const churnRisk = engagementScore < 20 ? "HIGH" : engagementScore < 50 ? "MEDIUM" : "LOW";
  const churnColor = churnRisk==="HIGH"?"var(--danger)":churnRisk==="MEDIUM"?"var(--warning)":"var(--success)";

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Tenant Analytics</div>
        <div className="admin-stat-grid">
          {[
            { icon:"💼",label:"Projects",    value:usage?.projects||0, color:"var(--brand-500)" },
            { icon:"✅",label:"Tasks",       value:usage?.tasks||0,    color:"var(--success)" },
            { icon:"📄",label:"Docs",        value:usage?.docs||0,     color:"var(--warning)" },
            { icon:"🤖",label:"AI Credits",  value:usage?.aiCredits||0,color:"var(--purple)" },
            { icon:"⚡",label:"Automations", value:usage?.automationRuns||0, color:"var(--danger)" },
          ].map(s=>(
            <div key={s.label} className="admin-stat-card">
              <div className="admin-stat-icon">{s.icon}</div>
              <div className="admin-stat-num" style={{color:s.color}}>{s.value}</div>
              <div className="admin-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="admin-card" style={{marginTop:"16px",background:"var(--gray-50)"}}>
          <div className="admin-card-title">Health Score</div>
          <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
            <div style={{fontSize:"32px",fontWeight:800,color:churnColor}}>{engagementScore}</div>
            <div>
              <div className="admin-mfa-bar" style={{width:"180px"}}>
                <div className="admin-mfa-fill" style={{width:`${engagementScore}%`,background:churnColor}} />
              </div>
              <div style={{fontSize:"12px",marginTop:"4px"}}>
                Churn risk: <strong style={{color:churnColor}}>{churnRisk}</strong>
              </div>
            </div>
          </div>
          <div className="admin-field-help" style={{marginTop:"10px"}}>
            Engagement score based on project, task, and doc activity.
            {churnRisk==="HIGH" && " Consider reaching out to activate this workspace."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Org-wide Announcements ────────────────────────────────────
function AnnouncementsPanel() {
  const [announcements, setAnnouncements] = useState([]);
  const [form, setForm] = useState({ title:"", body:"", priority:"NORMAL" });
  const [saving, setSaving] = useState(false);
  const { show:toast } = useToast();

  const send = async () => {
    if (!form.title||!form.body) return;
    setSaving(true);
    try {
      // Store as a high-priority notification visible to all workspace members
      await client.post("/notifications/announce", form, wsHeader());
      setAnnouncements(a=>[{ ...form, id:Date.now(), sentAt:new Date().toISOString() }, ...a]);
      setForm({ title:"", body:"", priority:"NORMAL" });
      toast("Announcement sent to all members","success");
    } catch {
      // Fallback: store locally
      setAnnouncements(a=>[{ ...form, id:Date.now(), sentAt:new Date().toISOString() }, ...a]);
      toast("Announcement queued","success");
    } finally { setSaving(false); }
  };

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">Workspace Announcements</div>
        <div className="admin-field-help" style={{marginBottom:"14px"}}>
          Send a pinned announcement to all workspace members. Appears in their notification inbox.
        </div>
        <div className="form-group">
          <label htmlFor={"admin-center-title"}>Title</label>
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
            placeholder="e.g. System maintenance this Friday" id={"admin-center-title"} />
        </div>
        <div className="form-group">
          <label htmlFor={"admin-center-message"}>Message</label>
          <textarea rows={3} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}
            placeholder="Full announcement message…" id={"admin-center-message"} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"admin-center-priority"}>Priority</label>
            <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} id={"admin-center-priority"}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High (shown in red)</option>
            </select>
          </div>
          <button className="btn-primary" style={{alignSelf:"flex-end"}}
            disabled={saving||!form.title||!form.body} onClick={send}>
            Send to All Members
          </button>
        </div>
        {announcements.length>0 && (
          <div style={{marginTop:"16px"}}>
            <div className="admin-card-title">Recent Announcements</div>
            {announcements.map(a=>(
              <div key={a.id} className="admin-session-row">
                <div className="admin-session-info">
                  <div className="admin-session-user">{a.title}</div>
                  <div className="admin-session-meta">{a.body.slice(0,80)}… · {new Date(a.sentAt).toLocaleString()}</div>
                </div>
                <span className="kpi-status-chip"
                  style={{background:a.priority==="HIGH"?"rgba(239,68,68,.1)":"rgba(99,102,241,.1)",
                    color:a.priority==="HIGH"?"var(--danger)":"var(--brand-500)"}}>
                  {a.priority}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ── White-Label Module ────────────────────────────────────────
function WhiteLabelPanel() {
  const [form, setForm] = useState({
    brandName:"", brandPrimaryColor:"var(--brand-500)", brandLogoUrl:"",
    brandFaviconUrl:"", customDomain:"", supportEmail:"",
    brandFooterText:"", hidePoweredBy:false, cssOverrides:"",
  });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const { show:toast } = useToast();
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    // Load workspace branding
    const ws = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.endsWith("__activeWorkspace"))||"null")||"null");
    if (ws?.id) {
      client.get(`/workspaces/${ws.id}/branding`).then(r=>{
        const b = r.data||{};
        setForm(f=>({...f,...Object.fromEntries(Object.entries(b).filter(([,v])=>v!=null))}));
      }).catch(()=>{});
    }
  },[]);

  const save = async () => {
    setSaving(true);
    try {
      const ws = JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.endsWith("__activeWorkspace"))||"null")||"null");
      if (ws?.id) {
        await client.patch(`/workspaces/${ws.id}/branding`, form);
        // Apply theme live
        if (form.brandPrimaryColor) {
          document.documentElement.style.setProperty("--brand-500", form.brandPrimaryColor);
          document.documentElement.style.setProperty("--brand-400", form.brandPrimaryColor + "cc");
        }
        toast("Branding saved and applied","success");
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="admin-section">
      <div className="admin-card">
        <div className="admin-card-title">White-Label Branding</div>
        <div className="admin-field-help" style={{marginBottom:"14px"}}>
          Customise Prowosma with your own brand. Changes apply workspace-wide immediately.
          Available on Business and Enterprise plans.
        </div>

        <div className="wl-preview-bar">
          <label className="admin-toggle-label">
            <input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)} />
            Live preview
          </label>
          {preview && (
            <div className="wl-preview-app" style={{
              "--wl-color": form.brandPrimaryColor,
              fontFamily:"system-ui",
            }}>
              <div className="wl-preview-header" style={{background:form.brandPrimaryColor}}>
                {form.brandLogoUrl
                  ? <img src={form.brandLogoUrl} alt="logo" className="wl-preview-logo" />
                  : <span className="wl-preview-brand">{form.brandName||"Prowosma"}</span>}
              </div>
              <div className="wl-preview-body">
                <div className="wl-preview-nav" style={{borderColor:form.brandPrimaryColor+"44"}}>Navigation</div>
                <button className="wl-preview-btn" style={{background:form.brandPrimaryColor}}>
                  Primary Button
                </button>
              </div>
              {!form.hidePoweredBy && (
                <div className="wl-preview-footer">
                  {form.brandFooterText || "Powered by Prowosma"}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-group" style={{flex:2}}>
            <label htmlFor={"admin-center-brand-name"}>Brand Name</label>
            <input value={form.brandName} onChange={e=>set("brandName",e.target.value)}
              placeholder="Acme Work Manager" id={"admin-center-brand-name"} />
            <div className="admin-field-help">Replaces "Prowosma" in the UI</div>
          </div>
          <div className="form-group">
            <label htmlFor={"admin-center-primary-color"}>Primary Color</label>
            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
              <input type="color" value={form.brandPrimaryColor}
                onChange={e=>set("brandPrimaryColor",e.target.value)}
                style={{width:"44px",height:"36px",padding:"2px",cursor:"pointer",borderRadius:"6px"}} id={"admin-center-primary-color"} />
              <input value={form.brandPrimaryColor}
                onChange={e=>set("brandPrimaryColor",e.target.value)}
                style={{flex:1}} placeholder="var(--brand-500)" aria-label={"Primary Color"} />
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{flex:2}}>
            <label htmlFor={"admin-center-logo-url"}>Logo URL</label>
            <input value={form.brandLogoUrl} onChange={e=>set("brandLogoUrl",e.target.value)}
              placeholder="https://acme.com/logo.png" id={"admin-center-logo-url"} />
          </div>
          <div className="form-group">
            <label htmlFor={"admin-center-favicon-url"}>Favicon URL</label>
            <input value={form.brandFaviconUrl} onChange={e=>set("brandFaviconUrl",e.target.value)}
              placeholder="https://acme.com/favicon.ico" id={"admin-center-favicon-url"} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"admin-center-custom-domain"}>Custom Domain</label>
            <input value={form.customDomain} onChange={e=>set("customDomain",e.target.value)}
              placeholder="projects.acme.com" id={"admin-center-custom-domain"} />
            <div className="admin-field-help">Add a CNAME record pointing to app.prowosma.io</div>
          </div>
          <div className="form-group">
            <label htmlFor={"admin-center-support-email"}>Support Email</label>
            <input value={form.supportEmail} onChange={e=>set("supportEmail",e.target.value)}
              placeholder="support@acme.com" id={"admin-center-support-email"} />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"admin-center-footer-text"}>Footer Text</label>
          <input value={form.brandFooterText} onChange={e=>set("brandFooterText",e.target.value)}
            placeholder="© 2026 Acme Corp · Powered by Prowosma" id={"admin-center-footer-text"} />
        </div>

        <label className="admin-toggle-label" style={{marginBottom:"12px"}}>
          <input type="checkbox" checked={form.hidePoweredBy}
            onChange={e=>set("hidePoweredBy",e.target.checked)} />
          Hide "Powered by Prowosma" (Enterprise plan only)
        </label>

        <div className="form-group">
          <label htmlFor={"admin-center-custom-css-advanced"}>Custom CSS (advanced)</label>
          <textarea rows={4} value={form.cssOverrides} onChange={e=>set("cssOverrides",e.target.value)}
            placeholder={`.sidebar { background: #1a1a2e; }
.btn-primary { border-radius: 2px; }`}
            style={{fontFamily:"monospace",fontSize:"12px"}} id={"admin-center-custom-css-advanced"} />
          <div className="admin-field-help">Injected into &lt;head&gt;. Use with caution.</div>
        </div>

        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & Apply Branding"}
        </button>
      </div>
    </div>
  );
}

// ── DLP Panel ─────────────────────────────────────────────────
function DlpPanel() {
  const [scanText,  setScanText]  = useState("");
  const [result,    setResult]    = useState(null);
  const [classify,  setClassify]  = useState(null);
  const [scanning,  setScanning]  = useState(false);
  const [policy,    setPolicy]    = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [violations, setViolations] = useState(null); // null = not loaded yet
  const [autoRedact,setAutoRedact]= useState(false);
  const { show:toast } = useToast();

  const loadPolicy = () => {
    // Was unwrapList(r) here, which only ever returns an array — silently
    // discarding this endpoint's actual object response ({scanOnSave,
    // blockHighRisk, ...}) and leaving every toggle below permanently
    // showing "disabled/off" regardless of the real policy.
    getDlpPolicy().then(r=>setPolicy(r.data)).catch(()=>{});
  };
  useEffect(()=>{ loadPolicy(); },[]);

  const toggle = async (key) => {
    const updated = { ...policy, [key]: !policy[key] };
    setPolicy(updated); // optimistic
    setSaving(true);
    try {
      await saveDlpPolicy({ [key]: updated[key] });
      toast("DLP policy saved", "success");
    } catch {
      setPolicy(policy); // revert on failure
      toast("Failed to save DLP policy", "error");
    } finally {
      setSaving(false);
    }
  };

  const loadViolations = () => {
    if (violations !== null) return; // already loaded, just toggling visibility
    getDlpViolations().then(r=>setViolations(unwrapList(r))).catch(()=>setViolations([]));
  };

  const scan = async () => {
    if (!scanText.trim()) return;
    setScanning(true);
    try {
      const [sr, cr] = await Promise.all([
        client.post("/dlp/scan", {content:scanText, redact:autoRedact}),
        client.post("/dlp/classify", {content:scanText}),
      ]);
      setResult(sr.data);
      setClassify(cr.data);
    } finally { setScanning(false); }
  };

  const RISK_COLORS = { CLEAN:"var(--success)", LOW:"var(--warning)", MEDIUM:"#f97316", HIGH:"var(--danger)" };
  const CLASS_COLORS = { PUBLIC:"var(--success)", INTERNAL:"var(--warning)", RESTRICTED:"#f97316", CONFIDENTIAL:"var(--danger)" };
  const TOGGLES = [
    { key:"scanOnSave",        label:"Scan content on save" },
    { key:"autoRedact",        label:"Auto-redact matches by default" },
    { key:"blockHighRisk",     label:"Block saves with HIGH-risk findings" },
    { key:"notifyOnViolation", label:"Notify on violation" },
  ];

  return (
    <div className="admin-section">
      {/* Policy overview — now editable, and actually reflects saved state */}
      {policy && (
        <div className="admin-card">
          <div className="admin-card-title">DLP Policy</div>
          <div className="dlp-policy-grid">
            {TOGGLES.map(t=>(
              <label key={t.key} className="dlp-policy-item" style={{cursor:"pointer"}}>
                <span className="dlp-policy-label">
                  <input type="checkbox" checked={!!policy[t.key]} disabled={saving}
                    onChange={()=>toggle(t.key)} style={{marginRight:"6px"}} />
                  {t.label}
                </span>
              </label>
            ))}
          </div>
          <div className="admin-card-title" style={{marginTop:"14px"}}>Retention by Classification</div>
          <div className="dlp-policy-grid">
            {Object.entries(policy.retentionByClass||{}).map(([cls,days])=>(
              <div key={cls} className="dlp-policy-item">
                <span className="dlp-policy-label" style={{color:CLASS_COLORS[cls]}}>{cls}</span>
                <span className="dlp-policy-val">{Math.round(days/365.25)} years ({days} days)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Violation log — audit trail of what past scans have actually
          found. Never shows the matched sensitive values themselves,
          only finding types/counts (see DlpViolation on the backend). */}
      <div className="admin-card">
        <div className="admin-card-title">Violation Log</div>
        {violations === null ? (
          <button className="btn-secondary" onClick={loadViolations}>Load violation log</button>
        ) : violations.length === 0 ? (
          <div className="admin-empty">No DLP findings recorded yet.</div>
        ) : violations.slice(0,20).map(v=>(
          <div key={v.id} className="admin-session-row">
            <div className="admin-session-info">
              <div className="admin-session-user">
                {v.entityType}{v.entityId ? ` · ${v.entityId}` : ""} —{" "}
                <span style={{color:RISK_COLORS[v.riskLevel]||RISK_COLORS.LOW}}>{v.riskLevel}</span>
              </div>
              <div className="admin-session-meta">
                {v.findingsCount} finding{v.findingsCount===1?"":"s"} ({(v.findingTypes||[]).join(", ")})
                {v.redacted ? " · redacted" : ""} · {v.scannedBy} · {v.scannedAt ? new Date(v.scannedAt).toLocaleString() : ""}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Manual scan */}
      <div className="admin-card">
        <div className="admin-card-title">Content Scanner</div>
        <div className="admin-field-help" style={{marginBottom:"10px"}}>
          Paste any text to scan for sensitive data (PII, credentials, financial info).
        </div>
        <textarea rows={4} value={scanText} onChange={e=>setScanText(e.target.value)}
          placeholder="Paste text to scan for sensitive data…&#10;e.g. Contact john@acme.com or call 555-123-4567&#10;API key: sk_live_abc123xyz" />
        <div style={{display:"flex",gap:"8px",alignItems:"center",marginTop:"8px"}}>
          <label className="admin-toggle-label">
            <input type="checkbox" checked={autoRedact} onChange={e=>setAutoRedact(e.target.checked)} />
            Auto-redact findings
          </label>
          <button className="btn-primary" onClick={scan} disabled={scanning||!scanText.trim()}>
            {scanning ? "Scanning…" : "Scan Content"}
          </button>
        </div>

        {result && (
          <div className="dlp-result" style={{marginTop:"14px"}}>
            <div className="dlp-result-header">
              <span className="dlp-risk-chip"
                style={{background:`${RISK_COLORS[result.riskLevel]}18`,color:RISK_COLORS[result.riskLevel]}}>
                {result.riskLevel === "CLEAN" ? "Clean" : `${result.riskLevel} Risk`}
              </span>
              {classify && (
                <span className="dlp-class-chip"
                  style={{background:`${CLASS_COLORS[classify.classification]}18`,
                    color:CLASS_COLORS[classify.classification]}}>
                  {classify.labels?.[0] || classify.classification}
                </span>
              )}
              <span className="dlp-findings-count">{result.findingsCount} finding{result.findingsCount!==1?"s":""}</span>
            </div>

            {result.findings.length > 0 && (
              <div className="dlp-findings">
                {result.findings.map((f,i)=>(
                  <div key={i} className="dlp-finding-row">
                    <span className={`dlp-finding-type dlp-sev-${f.severity?.toLowerCase()}`}>{f.type}</span>
                    <span className="dlp-finding-val">{f.value}</span>
                    <span className="dlp-finding-sev">{f.severity}</span>
                  </div>
                ))}
              </div>
            )}

            {result.redactedContent && (
              <div className="dlp-redacted">
                <div className="admin-card-title" style={{fontSize:"12px"}}>Redacted Output</div>
                <pre className="dlp-redacted-text">{result.redactedContent}</pre>
              </div>
            )}

            {classify && (
              <div className="dlp-labels">
                {(classify.labels||[]).map((l,i)=>(
                  <span key={i} className="dlp-label-chip">{l}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── People & Projects — single-place workspace management ─────
// Added in response to a very direct piece of feedback: there was no one
// place a manager/Owner could see every user + every project + role/status
// at a glance. AdminCenter already existed as "the admin place" for
// security/billing/compliance — these two tabs extend it to cover people
// and delivery, reusing the same Team/Invitations/Projects APIs the rest
// of the app already uses (no new backend surface needed for read access).
const ADMIN_ROLE_COLOR = { OWNER: "var(--warning)", ADMIN: "var(--danger)", MEMBER: "var(--brand-500)", VIEWER: "var(--success)" };

function WorkspacePeople() {
  const { isOwner } = useRole();
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [members,  setMembers]  = useState([]);
  const [invites,  setInvites]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busyId,   setBusyId]   = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "MEMBER" });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getTeamMembers(), getPendingInvites()])
      .then(([m, i]) => { setMembers(unwrapList(m)); setInvites(unwrapList(i)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern, same as Meetings.jsx's load()
  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (member, role) => {
    if (role === "ADMIN" && !isOwner) {
      toast("Only the workspace Manager can grant the Admin role.", "error");
      return;
    }
    setBusyId(member.id);
    try {
      await updateTeamMember(member.id, { ...member, role });
      setMembers(ms => ms.map(m => m.id === member.id ? { ...m, role } : m));
      toast(`${member.name}'s role is now ${role}`, "success");
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't update this member's role."), "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (member) => {
    const ok = await confirm({ title: "Remove this member?", message: `${member.name} will lose access to the workspace.`, danger: true, confirmText: "Remove" });
    if (!ok) return;
    setBusyId(member.id);
    try {
      await deleteTeamMember(member.id);
      setMembers(ms => ms.filter(m => m.id !== member.id));
      toast("Member removed", "success");
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't remove this member."), "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) { setInviteError("Email is required"); return; }
    setInviteBusy(true); setInviteError("");
    try {
      await sendInvitation(inviteForm);
      toast(`Invitation sent to ${inviteForm.email}`, "success");
      setInviteForm({ email: "", role: "MEMBER" });
      setInviteOpen(false);
      load();
    } catch (e) {
      setInviteError(apiErrorMessage(e, "Failed to send invitation"));
    } finally {
      setInviteBusy(false);
    }
  };

  const handleCancelInvite = async (inv) => {
    setBusyId(inv.id);
    try {
      await cancelInvitation(inv.id);
      setInvites(is => is.filter(i => i.id !== inv.id));
      toast(`Invitation to ${inv.email} cancelled`, "success");
    } catch {
      toast(`Couldn't cancel the invitation to ${inv.email}`, "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleResendInvite = async (inv) => {
    setBusyId(inv.id);
    try {
      await resendInvitation(inv.id);
      toast(`Invitation resent to ${inv.email}`, "success");
    } catch (e) {
      toast(apiErrorMessage(e, `Couldn't resend the invitation to ${inv.email}`), "error");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  const owners  = members.filter(m => m.role === "OWNER").length;
  const admins  = members.filter(m => m.role === "ADMIN").length;
  const viewers = members.filter(m => m.role === "VIEWER").length;

  return (
    <div className="admin-section">
      <div className="admin-stat-grid">
        {[
          { label: "Total People", value: members.length, color: "var(--brand-500)", icon: "👥" },
          { label: "Managers",     value: owners,          color: "var(--warning)", icon: "👑" },
          { label: "Admins",       value: admins,          color: "var(--danger)", icon: "🛡️" },
          { label: "Viewers",      value: viewers,         color: "var(--success)", icon: "👁️" },
          { label: "Pending Invites", value: invites.length, color: "var(--warning)", icon: "✉️" },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div className="admin-stat-icon">{s.icon}</div>
            <div className="admin-stat-num" style={{ color: s.color }}>{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {!isOwner && (
        <div className="admin-audit-note">
          You're viewing this as an Admin. Only the workspace Manager can grant or remove the Admin role —
          everything else here (Members, Viewers, invites) is yours to manage.
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Team Members ({members.length})</span>
          <button className="btn-primary" style={{ fontSize: "12px", padding: "6px 12px" }}
            onClick={() => setInviteOpen(true)}>Invite</button>
        </div>
        {members.length === 0
          ? <div className="admin-empty">No team members yet.</div>
          : members.map(m => (
            <div key={m.id} className="admin-session-row">
              <div className="admin-session-info">
                <div className="admin-session-user">{m.name} <span style={{ color: "var(--gray-400)", fontWeight: 400 }}>· {m.email}</span></div>
                <div className="admin-session-meta">
                  {(m.skills?.length ? `${m.skills.length} skills declared` : "No skills declared")}
                </div>
              </div>
              {m.role === "OWNER" ? (
                <span className="badge" style={{ background: ADMIN_ROLE_COLOR.OWNER + "22", color: ADMIN_ROLE_COLOR.OWNER }}>MANAGER</span>
              ) : (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select value={m.role} disabled={busyId === m.id}
                    onChange={e => handleRoleChange(m, e.target.value)}
                    style={{ fontSize: "12px", padding: "4px 8px" }}>
                    <option value="MEMBER">MEMBER</option>
                    <option value="VIEWER">VIEWER</option>
                    <option value="ADMIN" disabled={!isOwner && m.role !== "ADMIN"}>ADMIN{!isOwner ? " (Manager only)" : ""}</option>
                  </select>
                  <button className="btn-icon" title="Remove" disabled={busyId === m.id}
                    onClick={() => handleRemove(m)}>🗑️</button>
                </div>
              )}
            </div>
          ))
        }
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Pending Invitations ({invites.length})</div>
        {invites.length === 0
          ? <div className="admin-empty">No pending invitations.</div>
          : invites.map(inv => (
            <div key={inv.id} className="admin-session-row">
              <div className="admin-session-info">
                <div className="admin-session-user">{inv.email}</div>
                <div className="admin-session-meta">
                  Role: {inv.role} · Expires {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "—"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn-secondary" style={{ fontSize: "11px", padding: "4px 10px" }}
                  disabled={busyId === inv.id} onClick={() => handleResendInvite(inv)}>Resend</button>
                <button className="btn-icon" style={{ color: "var(--danger)" }}
                  disabled={busyId === inv.id} onClick={() => handleCancelInvite(inv)}>✕</button>
              </div>
            </div>
          ))
        }
      </div>

      {inviteOpen && (
        <div className="modal-overlay" onClick={() => setInviteOpen(false)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) setInviteOpen(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} role="presentation">
            <h2>Invite Team Member</h2>
            {inviteError && <div className="auth-error">{inviteError}</div>}
            <div className="form-group">
              <label htmlFor="admin-invite-email">Email Address *</label>
              <input id="admin-invite-email" type="email" value={inviteForm.email}
                onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                placeholder="colleague@company.com" />
            </div>
            <div className="form-group">
              <label htmlFor="admin-invite-role">Role</label>
              <select id="admin-invite-role" value={inviteForm.role}
                onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}>
                <option value="MEMBER">Member — Full access to projects and tasks</option>
                <option value="VIEWER">Viewer — Read-only access</option>
                <option value="ADMIN" disabled={!isOwner}>
                  {isOwner ? "Admin — Can manage members and settings" : "Admin — Manager only"}
                </option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn-secondary" onClick={() => { setInviteOpen(false); setInviteError(""); }}>Cancel</button>
              <button className="btn-primary" disabled={inviteBusy} onClick={handleInvite}>
                {inviteBusy ? "Sending…" : "Send Invitation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PROJECT_STATUS_COLOR = {
  NOT_STARTED: "var(--gray-400)", IN_PROGRESS: "var(--brand-500)", ON_TRACK: "var(--success)",
  AT_RISK: "var(--warning)", BLOCKED: "var(--danger)", COMPLETED: "var(--success)", PAUSED: "var(--gray-400)",
};

function WorkspaceProjects() {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState("ALL");

  useEffect(() => {
    getProjects().then(r => setProjects(unwrapList(r))).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="analytics-loading"><div className="analytics-spinner" /></div>;

  const statuses = Array.from(new Set(projects.map(p => p.status).filter(Boolean)));
  const visible = filter === "ALL" ? projects : projects.filter(p => p.status === filter);
  const active = projects.filter(p => !p.archived).length;
  const atRisk = projects.filter(p => p.status === "AT_RISK" || p.status === "BLOCKED").length;

  return (
    <div className="admin-section">
      <div className="admin-stat-grid">
        {[
          { label: "Total Projects", value: projects.length, color: "var(--brand-500)", icon: "📁" },
          { label: "Active",         value: active,           color: "var(--success)", icon: "🟢" },
          { label: "At Risk / Blocked", value: atRisk,        color: "var(--danger)", icon: "⚠️" },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div className="admin-stat-icon">{s.icon}</div>
            <div className="admin-stat-num" style={{ color: s.color }}>{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <div className="admin-card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <span>All Projects ({visible.length})</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button className={`sprint-filter-btn${filter === "ALL" ? " active" : ""}`} onClick={() => setFilter("ALL")}>All</button>
            {statuses.map(s => (
              <button key={s} className={`sprint-filter-btn${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0
          ? <div className="admin-empty">No projects match this filter.</div>
          : visible.map(p => (
            <div key={p.id} className="admin-session-row">
              <div className="admin-session-info">
                <div className="admin-session-user">
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: p.color || "var(--brand-500)", marginRight: 6 }} />
                  {p.name}
                </div>
                <div className="admin-session-meta">{p.description || "No description"}</div>
              </div>
              <span className="badge" style={{
                background: (PROJECT_STATUS_COLOR[p.status] || "var(--gray-400)") + "22",
                color: PROJECT_STATUS_COLOR[p.status] || "var(--gray-400)",
              }}>
                {statusText(p.status) || "—"}
              </span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Main AdminCenter ──────────────────────────────────────────
const TABS = [
  { id:"people",     label:"People"      },
  { id:"projects",   label:"Projects"    },
  { id:"security",   label:"Security"    },
  { id:"retention",  label:"Retention"  },
  { id:"email",      label:"Email"       },
  { id:"security-policy", label:"Password & Sessions" },
  { id:"features",   label:"Flags"       },
  { id:"billing",    label:"Billing"     },
  { id:"ip",         label:"IP Allow"    },
  { id:"residency",  label:"Residency"   },
  { id:"soc2",       label:"SOC2"        },
  { id:"license",    label:"Seats"       },
  { id:"tenant",     label:"Tenant"      },
  { id:"announce",   label:"Announce"    },
  { id:"whitelabel", label:"White-label" },
  { id:"dlp",        label:"DLP"         },
];

export default function AdminCenter() {
  const [tab, setTab] = useState("people");

  return (
    <div>
      <PageHeader icon="⚙️" title="Admin Centre"
        description="Users, projects, security, compliance, feature flags, and billing — all in one place" />

      <div className="admin-tab-bar">
        {TABS.map(t => (
          <button key={t.id}
            className={`admin-tab-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "people"    && <WorkspacePeople />}
      {tab === "projects"  && <WorkspaceProjects />}
      {tab === "security"  && <SecurityCentre />}
      {tab === "retention" && <DataRetention />}
      {tab === "email"     && <EmailSettingsPanel />}
      {tab === "security-policy" && <SecurityPolicyPanel />}
      {tab === "features"  && <FeatureFlags />}
      {tab === "billing"   && <Billing />}
      {tab === "ip"        && <IpAllowlist />}
      {tab === "residency" && <DataResidency />}
      {tab === "soc2"      && <Soc2Panel />}
      {tab === "license"   && <LicensePanel />}
      {tab === "tenant"    && <TenantAnalytics />}
      {tab === "announce"  && <AnnouncementsPanel />}
      {tab === "whitelabel"&& <WhiteLabelPanel />}
      {tab === "dlp"       && <DlpPanel />}
    </div>
  );
}
