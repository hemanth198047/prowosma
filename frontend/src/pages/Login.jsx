import { useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { isAuth0Configured } from "../config/auth0";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { Eye, EyeOff, Mail, KeyRound, Building2 } from "lucide-react";

import "../styles/pages/auth.css";
const API = (import.meta.env.VITE_API_URL || "http://localhost:9090") + "/api";
const LAST_EMAIL = "prowosma.lastEmail";
// The SAML redirect/ACS endpoints live outside the /api prefix (they're
// Spring Security's own SAML2 filter chain, not a REST controller), so we
// need the bare backend origin too — derived from API rather than a second
// hardcoded string, so the two can't silently drift apart.
const API_ORIGIN = API.replace(/\/api\/?$/, "");

// Translation keys, not literal text — see src/i18n/locales/en.json /
// es.json. Colors stay here since they're presentation, not translatable
// content.
// The brand panel lists a few plain facts (no metrics, no colour-coded chips).
const POINT_KEYS = ["boards", "collab", "docs", "reports"];

export default function Login() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [mode, setMode]   = useState("login");
  // Pre-fills when arriving from the "you're already a member — log in"
  // redirect on the Accept Invite page, so the person doesn't have to
  // retype the email they were just shown.
  // The last email used on this device is filled in, so people on the job only type their password.
  const [form, setForm]   = useState(() => {
    let last = "";
    try { last = localStorage.getItem(LAST_EMAIL) || ""; } catch { /* private mode */ }
    return { name: "", email: searchParams.get("email") || last, password: "" };
  });
  // "Keep me signed in on this device": on by default on phones and the installed app, off on shared computers.
  const [remember, setRemember] = useState(() => {
    try { return window.matchMedia("(max-width: 768px)").matches || window.matchMedia("(display-mode: standalone)").matches; } catch { return false; }
  });
  const [showPw, setShowPw] = useState(false);
  const [resetForm, setResetForm] = useState({ newPassword: "", confirmPassword: "" });
  // Step 2 of login for a 2FA-enabled account (see AuthService.login /
  // completeTwoFactorLogin on the backend) — the password already checked
  // out, this is just the 6-digit authenticator code.
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading,      setLoading]      = useState(false);
  const navigate = useNavigate();
  const { loginUser } = useAuth();
  const { loginWithRedirect: auth0Login } = useAuth0();

  // Auth0 SSO is always available — no need to load from backend

  // Enterprise SAML SSO (Okta / Azure AD / Google Workspace / a custom IdP)
  // is a *separate* login path from Auth0 above — it's configured per-
  // workspace by an admin (see Admin Center) via real IdP metadata, and the
  // backend only advertises a provider here once it's actually usable (see
  // AuthService.getConfiguredSsoProviders). Empty list = no SAML IdP is
  // configured yet, so this section just doesn't render — email/password
  // and Auth0 keep working exactly as before.
  const [ssoProviders, setSsoProviders] = useState([]);
  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/sso/providers`)
      .then((res) => {
        if (!cancelled) setSsoProviders(res.data?.saml || []);
      })
      .catch(() => {
        // No SSO configured, or the endpoint isn't reachable — fail silently
        // and just don't show the section, same as "no providers".
        if (!cancelled) setSsoProviders([]);
      });
    return () => { cancelled = true; };
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      if (mode === "login") { try { localStorage.setItem(LAST_EMAIL, form.email.trim()); } catch { /* private mode */ } }
      const payload  = mode === "login"
        ? { email: form.email, password: form.password, remember }
        : { name: form.name, email: form.email, password: form.password };
      const res = await axios.post(`${API}${endpoint}`, payload);

      // Password checked out, but this account has 2FA enabled — the
      // backend deliberately withheld a real token (see AuthService.login)
      // and just wants the authenticator code next. Don't try to treat
      // this response as a session; hand off to the code-entry step.
      if (res.data?.twoFactorRequired) {
        setMode("twoFactor");
        setError("");
        return;
      }

      await completeLogin(res.data);
    } catch (err) {
      if (err.response?.data?.error === "PASSWORD_EXPIRED") {
        // Password matched, but it's expired — route to the dedicated reset
        // flow instead of showing this as a plain login failure. The old
        // password (already typed above) carries over to prove identity.
        setMode("expiredReset");
        setError("");
      } else {
        setError(err.response?.data?.message || t("login.errors.genericFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Shared by a normal password-only login and the second (2FA-code) step
   * — both end the same way: store the token, show a brief "signed in as"
   * confirmation, navigate in. Only "login" (not "register") gets the
   * workspace-lookup confirmation, same as before this was extracted.
   */
  const completeLogin = async (data, { showWorkspaceConfirmation = mode === "login" } = {}) => {
    const { token, ...userData } = data;
    loginUser(userData, token);   // stores in sessionStorage + sets auth header

    // Brief, honest confirmation of what role/workspace the person is
    // entering as — previously login went straight to navigate("/") with
    // zero feedback about this at all. Best-effort: never blocks
    // navigation if the lookup fails or the account has no workspace yet
    // (e.g. a brand-new registration, which routes into workspace setup
    // instead, where the "you'll be the Owner" framing lives).
    if (showWorkspaceConfirmation) {
      try {
        const wsRes = await axios.get(`${API}/workspaces`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = Array.isArray(wsRes.data) ? wsRes.data : [];
        if (list.length > 0) {
          const primary = list[0];
          const roleLabel = {
            OWNER: t("login.roleOwner"), ADMIN: t("login.roleAdmin"),
            MEMBER: t("login.roleMember"), EDITOR: t("login.roleEditor"), VIEWER: t("login.roleViewer"),
          }[primary.role] || primary.role || t("login.roleMember");
          const extra = list.length > 1 ? ` (+${list.length - 1})` : "";
          setSuccess(t("login.signedInAs", { role: roleLabel, workspace: primary.name }) + extra);
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch { /* best-effort only */ }
    }
    navigate("/");
  };

  const handleTwoFactorSubmit = async () => {
    setError("");
    if (!twoFactorCode.trim()) {
      setError(t("login.twoFactor.errors.codeRequired", "Enter your 6-digit code"));
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/login/2fa`, {
        email: form.email,
        code: twoFactorCode.trim(),
        remember,
      });
      await completeLogin(res.data, { showWorkspaceConfirmation: true });
    } catch (err) {
      // A rejected/expired code doesn't get another free attempt against
      // the same password-verified window (see AuthService.
      // completeTwoFactorLogin) — send them back to re-enter the password
      // rather than leaving them stuck retyping a code that can never
      // succeed anymore.
      setError(err.response?.data?.message || t("login.twoFactor.errors.failed", "Invalid or expired code. Please log in again."));
      setMode("login");
      setTwoFactorCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleExpiredReset = async () => {
    setError("");
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setError(t("login.errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/reset-expired-password`, {
        email: form.email,
        oldPassword: form.password,
        newPassword: resetForm.newPassword,
      });
      const { token, ...userData } = res.data;
      loginUser(userData, token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || t("login.errors.resetFailed"));
    } finally {
      setLoading(false);
    }
  };


  if (mode === "twoFactor") {
    return (
      <Frame t={t}>
        <h1 className="auth-title">{t("login.twoFactor.heading", "Two-step verification")}</h1>
        <p className="auth-sub">{t("login.twoFactor.subtitle", "Enter the 6-digit code from your authenticator app")}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <form className="auth-form" noValidate onSubmit={(e) => { e.preventDefault(); handleTwoFactorSubmit(); }}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="two-factor-code">{t("login.twoFactor.codeLabel", "Authentication code")}</label>
            <input id="two-factor-code" className="auth-input" type="text"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              placeholder="123456" value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t("login.pleaseWait") : t("login.twoFactor.submit", "Verify & sign in")}
          </button>
        </form>
        <p className="auth-switch">
          <button type="button" className="auth-link"
            onClick={() => { setMode("login"); setError(""); setTwoFactorCode(""); }}>
            {t("login.twoFactor.backToSignIn", "Back to sign in")}
          </button>
        </p>
      </Frame>
    );
  }

  if (mode === "expiredReset") {
    return (
      <Frame t={t}>
        <h1 className="auth-title">{t("login.passwordExpired.heading")}</h1>
        <p className="auth-sub">{t("login.passwordExpired.subtitle")}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <form className="auth-form" noValidate onSubmit={(e) => { e.preventDefault(); handleExpiredReset(); }}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reset-new-password">{t("login.passwordExpired.newPasswordLabel")}</label>
            <input id="reset-new-password" className="auth-input" type="password" autoComplete="new-password"
              value={resetForm.newPassword}
              onChange={(e) => setResetForm(f => ({ ...f, newPassword: e.target.value }))} />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reset-confirm-password">{t("login.passwordExpired.confirmPasswordLabel")}</label>
            <input id="reset-confirm-password" className="auth-input" type="password" autoComplete="new-password"
              value={resetForm.confirmPassword}
              onChange={(e) => setResetForm(f => ({ ...f, confirmPassword: e.target.value }))} />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? t("login.pleaseWait") : t("login.passwordExpired.submit")}
          </button>
        </form>
        <p className="auth-switch">
          <button type="button" className="auth-link"
            onClick={() => { setMode("login"); setError(""); setResetForm({ newPassword: "", confirmPassword: "" }); }}>
            {t("login.passwordExpired.backToSignIn")}
          </button>
        </p>
      </Frame>
    );
  }

  const isLogin = mode === "login";
  const noEmoji = (v) => String(v).replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "");

  return (
    <div className="auth-page">

      {/* Brand panel (hidden on small screens) */}
      <aside className="auth-brand" aria-label={t("common.appName")}>
        <div className="auth-mark auth-mark--light"><img src="/logo-mark-64.png" width="32" height="32" alt="" /><span>{t("common.appName")}</span></div>
        <div className="auth-brand-copy">
          <p className="auth-tagline">{t("login.tagline1")} {t("login.taglineAccent")}</p>
          <p className="auth-desc">{t("login.description")}</p>
          <ul className="auth-points">
            {POINT_KEYS.map((k) => <li key={k}>{t(`login.chips.${k}`)}</li>)}
          </ul>
        </div>
        <p className="auth-brand-note">{t("login.selfHostedNote", "Runs on your own server. Your data stays with you.")}</p>
      </aside>

      <main className="auth-main" id="main">
        <header className="auth-main-top">
          <div className="auth-mark auth-mark--mobile"><img src="/logo-mark-64.png" width="28" height="28" alt="" /><span>{t("common.appName")}</span></div>
          <LanguageSwitcher className="auth-lang" />
        </header>

        <div className="auth-card">
          <h1 className="auth-title">{isLogin ? t("login.welcomeBack") : t("login.createAccountHeading")}</h1>
          <p className="auth-sub">{isLogin ? t("login.signInSubtitle") : t("login.registerSubtitle")}</p>

          {error   && <div className="auth-error" role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{noEmoji(success)}</div>}

          <form className="auth-form" noValidate onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            {!isLogin && (
              <>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="auth-name">{t("login.fullNameLabel")}</label>
                  <input id="auth-name" className="auth-input" name="name" type="text" autoComplete="name"
                    placeholder={t("login.fullNamePlaceholder")} value={form.name} onChange={handleChange} />
                </div>
                <p className="auth-note">{t("login.accountTypeNote")}</p>
              </>
            )}

            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-email">{t("login.emailLabel")}</label>
              <input id="auth-email" className="auth-input" name="email" type="email"
                placeholder={t("login.emailPlaceholder")} value={form.email}
                autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next"
                onChange={handleChange} />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-password">{t("login.passwordLabel")}</label>
              <div className="auth-pw-wrap">
                <input id="auth-password" className="auth-input" name="password" type={showPw ? "text" : "password"}
                  value={form.password}
                  autoComplete={isLogin ? "current-password" : "new-password"} enterKeyHint="go"
                  onChange={handleChange} />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? t("login.hidePassword", "Hide password") : t("login.showPassword", "Show password")} aria-pressed={showPw}>
                  {showPw ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
            </div>

            {isLogin && (
              <label className="auth-remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>{t("login.keepSignedIn", "Keep me signed in on this device")}<small>{t("login.keepSignedInHint", "For 30 days. Don't use on a shared computer.")}</small></span>
              </label>
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? t("login.pleaseWait") : noEmoji(isLogin ? t("login.signInSubmit") : t("login.createAccountSubmit")).replace(/\s*[→>]\s*$/, "")}
            </button>
          </form>

          {isLogin && (
            <div className="auth-alt">
              <div className="auth-or"><span>{t("login.orSignInWith")}</span></div>
              <button className="auth-secondary" type="button" onClick={async () => {
                if (!form.email) return setError(t("login.enterEmailFirst"));
                setError(""); setSuccess("");
                try {
                  const client = (await import("../api/client")).default;
                  await client.post("/auth/magic-link", { email: form.email });
                  setSuccess(t("login.magicLinkSentSuccess"));
                } catch { setError(t("login.magicLinkFailed")); }
              }}>
                <Mail size={16} aria-hidden="true" /> {noEmoji(t("login.magicLinkButton"))}
              </button>

              {isAuth0Configured && (
                <>
                  <div className="auth-social">
                    {[["google-oauth2", "Google"], ["windowslive", "Microsoft"], ["github", "GitHub"]].map(([p, label]) => (
                      <button key={p} type="button" className="auth-secondary"
                        onClick={() => auth0Login({ authorizationParams: { connection: p } })}>{label}</button>
                    ))}
                  </div>
                  <button className="auth-secondary" type="button" onClick={() => auth0Login()}>
                    <KeyRound size={16} aria-hidden="true" /> {t("login.continueWithAuth0")}
                  </button>
                </>
              )}

              {ssoProviders.length > 0 && (
                <>
                  <div className="auth-or"><span>{t("login.enterpriseSso")}</span></div>
                  {ssoProviders.map((provider) => (
                    <button key={provider.id} className="auth-secondary" type="button"
                      onClick={() => { window.location.href = `${API_ORIGIN}${provider.loginUrl}`; }}>
                      <Building2 size={16} aria-hidden="true" /> {t("login.continueWithProvider", { provider: provider.label })}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <p className="auth-switch">
            {isLogin ? t("login.newToProwosma") : t("login.alreadyHaveAccount")}{" "}
            <button type="button" className="auth-link"
              onClick={() => { setMode(isLogin ? "register" : "login"); setError(""); setSuccess(""); }}>
              {isLogin ? t("login.createFreeAccount") : t("login.signInInstead")}
            </button>
          </p>
        </div>

        <AuthFooter t={t} />
      </main>
    </div>
  );
}

/* Shared frame for the short single-purpose screens (2-step code, expired password). */
function Frame({ t, children }) {
  return (
    <div className="auth-page auth-page--single">
      <main className="auth-main" id="main">
        <header className="auth-main-top">
          <div className="auth-mark"><img src="/logo-mark-64.png" width="28" height="28" alt="" /><span>{t("common.appName")}</span></div>
          <LanguageSwitcher className="auth-lang" />
        </header>
        <div className="auth-card">{children}</div>
        <AuthFooter t={t} />
      </main>
    </div>
  );
}

function AuthFooter({ t }) {
  return (
    <footer className="auth-footer">
      <span>{t("login.footer", { year: new Date().getFullYear(), appName: t("common.appName") })}</span>
      <nav aria-label="Legal" className="auth-legal">
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
      </nav>
    </footer>
  );
}
