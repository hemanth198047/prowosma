import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { acceptInvitation } from "../api/invitations";
import { login, register } from "../api/auth";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";

import "../styles/pages/auth.css";
export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { loginUser, setActiveWorkspace } = useAuth();

  // Invite info fetched from backend
  const [invitedEmail, setInvitedEmail]     = useState("");
  const [invitedRole, setInvitedRole]       = useState("");
  const [invitedWorkspace, setInvitedWorkspace] = useState("");

  // Page state
  const [step, setStep]     = useState("loading"); // loading | form | success | error
  const [mode, setMode]     = useState("register"); // register | login
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [form, setForm]     = useState({ name: "", password: "", confirmPassword: "" });

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Fetch invite details on mount — completely independent of who is logged in
  useEffect(() => {
    const init = async () => {
      if (!token) {
        setStep("error");
        setError("Invalid invitation link. Please check the link and try again.");
        return;
      }
      try {
        const res = await client.get(`/invitations/info?token=${token}`);
        const inv = res.data;
        setInvitedEmail(inv.email);
        setInvitedRole(inv.role);
        setInvitedWorkspace(inv.workspaceName);
        // If account already exists, default to login mode
        setMode(inv.accountExists ? "login" : "register");
        setStep("form");
      } catch (e) {
        setStep("error");
        setError(
          e.response?.data?.message ||
          "This invitation link is invalid or has expired."
        );
      }
    };
    init();
  }, [token]);

  const handleSubmit = async () => {
    setError("");

    // Validate
    if (!form.password || form.password.length < 6) {
      setError("Password must be at least 6 characters"); return;
    }
    if (mode === "register") {
      if (!form.name.trim()) { setError("Name is required"); return; }
      if (form.password !== form.confirmPassword) {
        setError("Passwords do not match"); return;
      }
    }

    setLoading(true);
    try {
      // Step 1 — Log in or register with the INVITED email
      let authRes;
      if (mode === "register") {
        authRes = await register({
          name: form.name.trim(),
          email: invitedEmail,
          password: form.password,
        });
      } else {
        authRes = await login({
          email: invitedEmail,
          password: form.password,
        });
      }

      // Step 2 — Set auth token so subsequent calls are authenticated
      const token2 = authRes.data.token;
      client.defaults.headers.common["Authorization"] = `Bearer ${token2}`;

      // Step 3 — Accept the invitation
      const acceptRes = await acceptInvitation({
        token,
        name: form.name.trim() || authRes.data.name,
        password: form.password,
      });

      // Step 4 — Log in to the app with this user
      loginUser(authRes.data, token2);
      if (acceptRes.data?.workspace?.id) {
        setActiveWorkspace(acceptRes.data.workspace);
      }

      setStep("success");
    } catch (e) {
      setError(
        e.response?.data?.message ||
        (mode === "login"
          ? "Incorrect password. Please try again."
          : "Failed to create account. This email may already be registered.")
      );
    } finally {
      setLoading(false);
    }
  };

  const roleLabel = {
    OWNER: "👑 Manager", ADMIN: "🛡️ Admin",
    MEMBER: "👤 Member", VIEWER: "👁️ Viewer",
  }[invitedRole] || invitedRole;

  return (
    <div className="accept-invite-page">
      <div className="accept-invite-card">
        <div className="accept-invite-logo">Prowosma</div>

        {/* Loading */}
        {step === "loading" && (
          <div className="accept-invite-loading">⏳ Loading invitation...</div>
        )}

        {/* Error */}
        {step === "error" && (
          <div style={{ textAlign: "center" }}>
            <div className="accept-invite-icon">❌</div>
            <h2 className="accept-invite-title">Invitation Error</h2>
            <p className="accept-invite-desc">{error}</p>
            <button
              className="btn-primary"
              style={{ width: "100%", marginTop: "16px" }}
              onClick={() => navigate("/login")}
            >
              Go to Login
            </button>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div style={{ textAlign: "center" }}>
            <div className="accept-invite-icon">🎉</div>
            <h2 className="accept-invite-title">
              Welcome to {invitedWorkspace}!
            </h2>
            <p className="accept-invite-desc">
              You've joined as <strong>{roleLabel}</strong>.
              You can now access all workspace data according to your role.
            </p>
            <button
              className="btn-primary"
              style={{ width: "100%", marginTop: "20px", padding: "13px", fontSize: "15px" }}
              onClick={() => navigate("/")}
            >
              Go to Dashboard →
            </button>
          </div>
        )}

        {/* Form — completely independent, shows invited email read-only */}
        {step === "form" && (
          <div>
            <div className="accept-invite-icon">✉️</div>
            <h2 className="accept-invite-title">You've been invited!</h2>

            {/* Invite summary */}
            <div className="invite-summary-box">
              <div className="invite-summary-row">
                <span className="invite-summary-label">Workspace</span>
                <span className="invite-summary-value">{invitedWorkspace}</span>
              </div>
              <div className="invite-summary-row">
                <span className="invite-summary-label">Your Role</span>
                <span className="invite-summary-value">{roleLabel}</span>
              </div>
              <div className="invite-summary-row">
                <span className="invite-summary-label">Invited Email</span>
                <span className="invite-summary-value"
                  style={{ color: "var(--brand-600)", fontWeight: 700 }}>
                  {invitedEmail}
                </span>
              </div>
            </div>

            {/* Mode toggle */}
            <div className="auth-tabs" style={{ marginBottom: "20px" }}>
              <button
                className={"auth-tab" + (mode === "register" ? " active" : "")}
                onClick={() => { setMode("register"); setError(""); }}
              >
                New Account
              </button>
              <button
                className={"auth-tab" + (mode === "login" ? " active" : "")}
                onClick={() => { setMode("login"); setError(""); }}
              >
                Already Have Account
              </button>
            </div>

            {error && <div className="auth-error">⚠️ {error}</div>}

            {/* Register fields */}
            {mode === "register" && (
              <div className="form-group">
                <label htmlFor={"accept-invite-your-name"}>Your Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder="John Doe" id={"accept-invite-your-name"}
                 
                />
              </div>
            )}

            {/* Email — always read-only, pre-filled from invite */}
            <div className="form-group">
              <label htmlFor={"accept-invite-email-address"}>Email Address</label>
              <input
                value={invitedEmail}
                disabled
                style={{ background: "var(--gray-50)",
                  cursor: "not-allowed", color: "var(--gray-500)" }} id={"accept-invite-email-address"}
              />
              <span style={{ fontSize: "11px", color: "var(--gray-400)", marginTop: "4px", display: "block" }}>
                This is the email the invitation was sent to
              </span>
            </div>

            <div className="form-group">
              <label htmlFor={"accept-invite-password"}>Password *</label>
              <input
                value={form.password}
                onChange={(e) => setField("password", e.target.value)}
                type="password"
                placeholder={mode === "register"
                  ? "Create a password (min 6 chars)"
                  : "Enter your password"} id={"accept-invite-password"}
               
              />
            </div>

            {mode === "register" && (
              <div className="form-group">
                <label htmlFor={"accept-invite-confirm-password"}>Confirm Password *</label>
                <input
                  value={form.confirmPassword}
                  onChange={(e) => setField("confirmPassword", e.target.value)}
                  type="password"
                  placeholder="Repeat password"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()} id={"accept-invite-confirm-password"}
                />
              </div>
            )}

            {mode === "login" && (
              <div role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
            )}

            <button
              className="btn-primary"
              style={{ width: "100%", padding: "13px", fontSize: "15px", marginTop: "4px" }}
              disabled={loading}
              onClick={handleSubmit}
            >
              {loading
                ? "⏳ Please wait..."
                : mode === "register"
                  ? "🚀 Create Account & Join"
                  : "✅ Sign In & Join"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
