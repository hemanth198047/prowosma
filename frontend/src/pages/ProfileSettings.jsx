import { useState, useEffect } from "react";
import { unwrapList } from "../api/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import PageHeader from "../components/PageHeader";
import client from "../api/client";

export default function ProfileSettings() {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();

  const [section, setSection]         = useState("profile");
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting]       = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  // ── 2FA state ─────────────────────────────────────────────
  const [twoFaEnabled, setTwoFaEnabled]   = useState(false);
  const [twoFaSetup, setTwoFaSetup]       = useState(null);   // { secret, qrUrl }
  const [twoFaCode, setTwoFaCode]         = useState("");
  const [twoFaLoading, setTwoFaLoading]   = useState(false);
  const [disableCode, setDisableCode]     = useState("");

  // ── Sessions state ────────────────────────────────────────
  const [sessions, setSessions]           = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const r = await client.get("/security/sessions");
      setSessions(unwrapList(r));
    } catch (e) { console.error(e); }
    finally { setSessionsLoading(false); }
  };

  // Load 2FA status when security tab opens
  useEffect(() => {
    if (section !== "security") return;
    client.get("/security/2fa/status").then(r => setTwoFaEnabled(r.data.enabled)).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern
    loadSessions();
  }, [section]);

  // ── 2FA handlers ──────────────────────────────────────────
  const start2faSetup = async () => {
    setTwoFaLoading(true); setError("");
    try {
      const r = await client.post("/security/2fa/setup");
      // Was unwrapList(r) — that helper only ever returns an array, and
      // this endpoint returns a single {secret, qrCodeUrl, ...} object, so
      // the QR/secret data needed to actually complete 2FA setup was being
      // silently discarded every time.
      setTwoFaSetup(r.data);
    } catch (e) { setError(e.response?.data?.error || "Setup failed"); }
    finally { setTwoFaLoading(false); }
  };

  const verify2fa = async () => {
    if (twoFaCode.length !== 6) return;
    setTwoFaLoading(true); setError("");
    try {
      await client.post("/security/2fa/verify", { code: twoFaCode });
      setTwoFaEnabled(true); setTwoFaSetup(null); setTwoFaCode("");
      setSuccess("2FA enabled successfully!");
      setTimeout(() => setSuccess(""), 4000);
    } catch (e) { setError(e.response?.data?.error || "Invalid code"); }
    finally { setTwoFaLoading(false); }
  };

  const disable2fa = async () => {
    if (!disableCode || disableCode.length !== 6) return;
    setTwoFaLoading(true); setError("");
    try {
      await client.post("/security/2fa/disable", { code: disableCode });
      setTwoFaEnabled(false); setDisableCode("");
      setSuccess("2FA disabled.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (e) { setError(e.response?.data?.error || "Invalid code"); }
    finally { setTwoFaLoading(false); }
  };

  // ── Session handlers ──────────────────────────────────────
  const revokeSession = async (id) => {
    await client.delete(`/security/sessions/${id}`);
    loadSessions();
  };
  const revokeAllSessions = async () => {
    await client.delete("/security/sessions");
    loadSessions();
  };

  // ── GDPR export ───────────────────────────────────────────
  const exportData = async () => {
    try {
      const r = await client.get("/security/gdpr/export");
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "prowosma-my-data.json";
      a.click(); URL.revokeObjectURL(url);
      setSuccess("Data exported successfully!");
      setTimeout(() => setSuccess(""), 4000);
    } catch { setError("Export failed"); }
  };

  // ── Account deletion ──────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (confirmation !== "DELETE MY ACCOUNT") {
      setError("Type 'DELETE MY ACCOUNT' exactly to confirm"); return;
    }
    setDeleting(true); setError("");
    try {
      await client.delete("/users/me", { data: { confirmation: "DELETE MY ACCOUNT" } });
      logoutUser(); navigate("/login");
    } catch (e) {
      setError(e.response?.data?.message || "Failed to delete account");
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader icon="👤" title="Profile & Settings" description="Manage your account, security and privacy" />

      <div className="tab-bar" style={{ marginBottom: "24px" }}>
        <button className={"tab-btn" + (section === "profile"  ? " tab-active" : "")} onClick={() => { setSection("profile");  setError(""); setSuccess(""); }}>👤 Profile</button>
        <button className={"tab-btn" + (section === "security" ? " tab-active" : "")} onClick={() => { setSection("security"); setError(""); setSuccess(""); }}>🔐 Security</button>
        <button className={"tab-btn" + (section === "gdpr"     ? " tab-active" : "")} onClick={() => { setSection("gdpr");     setError(""); setSuccess(""); }}>📋 Privacy & GDPR</button>
        <button className={"tab-btn" + (section === "danger"   ? " tab-active" : "")} onClick={() => { setSection("danger");   setError(""); setSuccess(""); }}>⚠️ Delete Account</button>
      </div>

      {error   && <div className="settings-error-banner"  style={{ marginBottom: "16px" }}>⚠️ {error}</div>}
      {success && <div className="settings-success-banner" style={{ marginBottom: "16px" }}>✅ {success}</div>}

      {/* ── Profile ── */}
      {section === "profile" && (
        <div className="settings-section">
          <div className="settings-section-title">Account Information</div>
          <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "24px" }}>
            <div style={{ width:"72px", height:"72px", borderRadius:"50%",
              background:"linear-gradient(135deg,var(--brand-500),var(--brand-700))",
              color:"#fff", fontSize:"28px", fontWeight:800,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {user?.name?.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize:"20px", fontWeight:700, color:"var(--gray-900)" }}>{user?.name}</div>
              <div style={{ fontSize:"14px", color:"var(--gray-500)", marginTop:"4px" }}>{user?.email}</div>
            </div>
          </div>
          <div className="form-group" style={{ maxWidth:"400px" }}>
            <label htmlFor={"profile-settings-full-name"}>Full Name</label>
            <input value={user?.name || ""} disabled style={{ background:"var(--gray-50)", cursor:"not-allowed" }} id={"profile-settings-full-name"} />
          </div>
          <div className="form-group" style={{ maxWidth:"400px" }}>
            <label htmlFor={"profile-settings-email-address"}>Email Address</label>
            <input value={user?.email || ""} disabled style={{ background:"var(--gray-50)", cursor:"not-allowed" }} id={"profile-settings-email-address"} />
          </div>
          <p style={{ fontSize:"12px", color:"var(--gray-400)", marginTop:"8px" }}>
            To update your name or email, contact your workspace admin.
          </p>
        </div>
      )}

      {/* ── Security ── */}
      {section === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* 2FA */}
          <div className="settings-section">
            <div className="settings-section-title">🔐 Two-Factor Authentication (2FA)</div>
            <p style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"16px" }}>
              Add an extra layer of security. Once enabled, you'll need a 6-digit code from your authenticator app on every login.
            </p>

            {twoFaEnabled ? (
              <div>
                <div className="sec-2fa-enabled-badge">✅ 2FA is enabled on your account</div>
                <div style={{ marginTop:"16px" }}>
                  <label style={{ fontSize:"13px", fontWeight:600, display:"block", marginBottom:"8px" }} htmlFor={"profile-settings-enter-your-2fa-code-to-disable"}>
                    Enter your 2FA code to disable:
                  </label>
                  <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                    <input value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                      placeholder="000000" maxLength={6}
                      style={{ width:"120px", letterSpacing:"0.3em", fontSize:"16px", textAlign:"center" }} id={"profile-settings-enter-your-2fa-code-to-disable"} />
                    <button className="btn-secondary" style={{ color:"var(--danger)" }}
                      disabled={disableCode.length !== 6 || twoFaLoading}
                      onClick={disable2fa}>
                      {twoFaLoading ? "⏳" : "🔓 Disable 2FA"}
                    </button>
                  </div>
                </div>
              </div>
            ) : !twoFaSetup ? (
              <button className="btn-primary" onClick={start2faSetup} disabled={twoFaLoading}>
                {twoFaLoading ? "⏳ Setting up…" : "🔐 Enable 2FA"}
              </button>
            ) : (
              <div className="sec-2fa-setup">
                <div className="sec-2fa-steps">
                  <div className="sec-2fa-step">
                    <span className="sec-step-num">1</span>
                    Install an authenticator app (Google Authenticator, Authy, 1Password)
                  </div>
                  <div className="sec-2fa-step">
                    <span className="sec-step-num">2</span>
                    Scan this QR code:
                  </div>
                </div>
                <div className="sec-qr-block">
                  <img src={twoFaSetup.qrUrl} alt="QR Code" className="sec-qr-img" />
                  <div className="sec-qr-secret">
                    <span style={{ fontSize:"11px", color:"var(--gray-400)" }}>Or enter manually:</span>
                    <code className="sec-secret-code">{twoFaSetup.secret}</code>
                  </div>
                </div>
                <div className="sec-2fa-step" style={{ marginTop:"12px" }}>
                  <span className="sec-step-num">3</span>
                  Enter the 6-digit code from your app to verify:
                </div>
                <div style={{ display:"flex", gap:"8px", alignItems:"center", marginTop:"10px" }}>
                  <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                    placeholder="000000" maxLength={6}
                    style={{ width:"140px", letterSpacing:"0.3em", fontSize:"18px", textAlign:"center" }}
                    onKeyDown={e => e.key === "Enter" && verify2fa()} />
                  <button className="btn-primary" onClick={verify2fa}
                    disabled={twoFaCode.length !== 6 || twoFaLoading}>
                    {twoFaLoading ? "⏳ Verifying…" : "✓ Verify & Enable"}
                  </button>
                  <button className="btn-secondary" onClick={() => setTwoFaSetup(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Email OTP ── */}
          <div className="settings-section">
            <div className="settings-section-title">📱 Email OTP (Second Factor)</div>
            <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"12px"}}>
              Receive a one-time 6-digit code to your email as an additional login factor.
            </p>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
              <button className="btn-secondary" onClick={async()=>{
                const user = JSON.parse(localStorage.getItem("user")||"{}");
                if (!user.email) return;
                await client.post("/auth/mfa/email-otp/send",{email:user.email});
                alert("OTP sent to " + user.email);
              }}>📤 Send Test OTP</button>
              <input id="ps-otp-input" placeholder="6-digit code" style={{maxWidth:150}} />
              <button className="btn-primary" onClick={async()=>{
                const code = document.getElementById("ps-otp-input")?.value;
                const user = JSON.parse(localStorage.getItem("user")||"{}");
                if (!code || !user.email) return;
                const r = await client.post("/auth/mfa/email-otp/verify",{email:user.email,otp:code});
                alert(r.data.verified ? "✅ Email OTP verified!" : "❌ Invalid or expired code");
              }}>Verify</button>
            </div>
          </div>

          {/* ── Backup Codes ── */}
          <div className="settings-section">
            <div className="settings-section-title">🔑 MFA Backup Codes</div>
            <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"12px"}}>
              Generate 8 one-time emergency backup codes. Store them securely — each code works once.
            </p>
            <button className="btn-secondary" onClick={async()=>{
              const user = JSON.parse(localStorage.getItem("user")||"{}");
              if (!user.email) return;
              const r = await client.post("/auth/mfa/backup-codes/generate",{email:user.email});
              const codes = (r.data.codes||[]).join("\n");
              alert("Your backup codes (copy and store securely):\n\n"+codes+"\n\n⚠️ "+r.data.warning);
            }}>🔑 Generate Backup Codes</button>
          </div>

          {/* Active Sessions */}
          <div className="settings-section">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
              <div className="settings-section-title" style={{ marginBottom:0 }}>💻 Active Sessions</div>
              {sessions.filter(s => !s.current).length > 0 && (
                <button className="btn-secondary" style={{ fontSize:"12px", color:"var(--danger)" }}
                  onClick={revokeAllSessions}>
                  Revoke All Other Sessions
                </button>
              )}
            </div>
            <p style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"14px" }}>
              Devices and browsers that have logged into your account.
            </p>
            {sessionsLoading ? <div style={{ color:"var(--gray-400)", fontSize:"13px" }}>Loading…</div>
            : sessions.length === 0 ? <div style={{ color:"var(--gray-400)", fontSize:"13px" }}>No sessions recorded yet.</div>
            : (
              <div className="sec-sessions-list">
                {[...sessions].reverse().map(s => (
                  <div key={s.id} className={`sec-session-row ${s.current ? "current" : ""}`}>
                    <div className="sec-session-icon">
                      {s.device?.includes("iPhone") || s.device?.includes("Android") ? "📱" : "💻"}
                    </div>
                    <div className="sec-session-info">
                      <div className="sec-session-device">
                        {s.device || "Unknown device"}
                        {s.current && <span className="sec-current-badge">Current session</span>}
                      </div>
                      <div className="sec-session-meta">
                        {s.ipAddress && <span>IP: {s.ipAddress}</span>}
                        {s.createdAt && <span>· {new Date(s.createdAt).toLocaleString()}</span>}
                      </div>
                    </div>
                    {!s.current && (
                      <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px", color:"var(--danger)" }}
                        onClick={() => revokeSession(s.id)}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Privacy & GDPR ── */}
      {section === "gdpr" && (
        <div className="settings-section">
          <div className="settings-section-title">📋 Privacy & GDPR</div>
          <p style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"20px" }}>
            Under GDPR and similar regulations, you have the right to access and export all data we hold about you.
          </p>

          <div className="sec-gdpr-card">
            <div className="sec-gdpr-icon">📥</div>
            <div>
              <div style={{ fontWeight:700, fontSize:"14px", marginBottom:"4px" }}>Export My Data</div>
              <div style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"12px" }}>
                Download a JSON file containing all your profile data, tasks, projects, and login history.
              </div>
              <button className="btn-primary" onClick={exportData}>
                📥 Download My Data
              </button>
            </div>
          </div>

          <div className="sec-gdpr-card" style={{ marginTop:"16px" }}>
            <div className="sec-gdpr-icon">🔒</div>
            <div>
              <div style={{ fontWeight:700, fontSize:"14px", marginBottom:"4px" }}>What data we store</div>
              <ul style={{ fontSize:"13px", color:"var(--gray-600)", paddingLeft:"18px", lineHeight:"2", margin:0 }}>
                <li>Account information (name, email, hashed password)</li>
                <li>Workspace membership and role</li>
                <li>Tasks, projects and goals you created or were assigned to</li>
                <li>Activity log entries attributed to your account</li>
                <li>Login sessions and IP addresses</li>
                <li>File attachments you uploaded</li>
              </ul>
            </div>
          </div>

          <div className="sec-gdpr-card" style={{ marginTop:"16px" }}>
            <div className="sec-gdpr-icon">✉️</div>
            <div>
              <div style={{ fontWeight:700, fontSize:"14px", marginBottom:"4px" }}>Right to Erasure</div>
              <div style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"12px" }}>
                You can request permanent deletion of all your personal data. This is irreversible.
              </div>
              <button className="btn-secondary" style={{ color:"var(--danger)" }}
                onClick={async () => {
                  if (!confirm("Submit a data deletion request? Your account will be deleted within 30 days.")) return;
                  await client.post("/security/gdpr/delete-request");
                  setSuccess("Deletion request submitted. You'll receive a confirmation email.");
                }}>
                🗑️ Request Data Deletion
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Danger Zone ── */}
      {section === "danger" && (
        <div className="settings-section settings-danger-section">
          <div className="settings-section-title settings-danger-title">⚠️ Delete Account</div>
          <div className="settings-danger-body">
            <div>
              <div className="settings-danger-label">Permanently delete your account</div>
              <div className="settings-danger-desc">This will permanently delete:</div>
              <ul style={{ marginTop:"10px", paddingLeft:"20px", color:"var(--gray-600)", fontSize:"13px", lineHeight:"2" }}>
                <li>Your user account and login credentials</li>
                <li>All workspaces you own</li>
                <li>All projects, tasks, goals in those workspaces</li>
                <li>All team members, activity logs, notifications</li>
                <li>All AI settings and integrations</li>
              </ul>
              <p style={{ marginTop:"12px", fontSize:"13px", fontWeight:700, color:"var(--danger)" }}>
                ⚠️ This action is permanent and cannot be undone.
              </p>
            </div>
            <div className="settings-delete-confirm">
              <label style={{ fontSize:"13px", color:"var(--gray-600)", marginBottom:"8px", display:"block" }} htmlFor={"profile-settings-type-to-confirm"}>
                Type <strong>DELETE MY ACCOUNT</strong> to confirm:
              </label>
              <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
                <input value={confirmation} onChange={e => { setConfirmation(e.target.value); setError(""); }}
                  placeholder="DELETE MY ACCOUNT" style={{ maxWidth:"260px",
                    borderColor: confirmation === "DELETE MY ACCOUNT" ? "#10b981" : undefined }} id={"profile-settings-type-to-confirm"} />
                <button className="btn-danger"
                  disabled={deleting || confirmation !== "DELETE MY ACCOUNT"}
                  onClick={handleDeleteAccount}>
                  {deleting ? "⏳ Deleting..." : "🗑️ Delete My Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
