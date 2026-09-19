import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { acceptInvitation } from "../api/invitations";
import { login, register } from "../api/auth";
import client, { clearAllCache } from "../api/client";
import { useAuth } from "../hooks/useAuth";

import "../styles/pages/auth.css";
export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { loginUser, setActiveWorkspace, logoutUser } = useAuth();

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
      // An invite link is always a fresh start, regardless of what this
      // browser was doing before — someone else's still-logged-in session
      // (a shared/demo machine), a stale/expired token left over from an
      // earlier visit, or cached API responses for a different workspace
      // can otherwise leak into this flow (a stale Authorization header
      // on the very first request below used to get this whole page
      // bounced to /login before the invitee ever saw it — see
      // SecurityConfig.PUBLIC_PATHS). Clearing everything up front makes
      // this page behave the same regardless of the browser's prior state.
      logoutUser();
      clearAllCache();
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
        // Distinct from every other failure: this means the person
        // genuinely, completely already joined — not a broken/expired
        // link. Route them somewhere useful (log in) instead of a red
        // dead-end error, and carry their email over so they don't have
        // to retype it.
        if (e.response?.data?.alreadyMember) {
          setInvitedEmail(e.response.data.email || "");
          setStep("already_member");
          return;
        }
        setStep("error");
        setError(
          // getInfo()'s own inline error responses (expired/revoked/not
          // found) use an "error" field holding the actual human-readable
          // reason — this previously only checked "message" (the shape
          // thrown-exception errors elsewhere in this app use), so a
          // specific, useful reason like "Invitation has expired" was
          // always silently discarded in favor of the generic fallback
          // below. Checking both means whichever shape the failure came
          // in gets shown.
          e.response?.data?.error ||
          e.response?.data?.message ||
          "This invitation link is invalid or has expired."
        );
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Same distinct case as the info-fetch above — a race is possible
      // (e.g. two tabs completing the same invite around the same time).
      if (e.response?.data?.alreadyMember) {
        setStep("already_member");
        return;
      }
      setError(
        // acceptByBody()'s error responses use an "error" field, not
        // "message" — see the matching note on the info-fetch catch above.
        e.response?.data?.error ||
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
        <div className="accept-invite-logo">
          <img src="/logo-wordmark.png" alt="Prowosma" />
        </div>

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

        {/* Already a member — distinct from a broken/expired link. Friendly
            "welcome back" framing, not a red error, since nothing is
            actually wrong: this person just already finished joining. */}
        {step === "already_member" && (
          <div style={{ textAlign: "center" }}>
            <div className="accept-invite-icon">👋</div>
            <h2 className="accept-invite-title">You're already in!</h2>
            <p className="accept-invite-desc">
              {invitedEmail ? <>The account for <strong>{invitedEmail}</strong> has</> : "This account has"}{" "}
              already joined {invitedWorkspace || "this workspace"}. Just log in to pick up where you left off.
            </p>
            <button
              className="btn-primary"
              style={{ width: "100%", marginTop: "16px" }}
              onClick={() => navigate(`/login${invitedEmail ? `?email=${encodeURIComponent(invitedEmail)}` : ""}`)}
            >
              Go to Login →
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
