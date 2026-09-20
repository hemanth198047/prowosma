import { useState, useEffect, Fragment } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { isAuth0Configured } from "../config/auth0";
import LanguageSwitcher from "../components/LanguageSwitcher";

import "../styles/pages/auth.css";
const API = (import.meta.env.VITE_API_URL || "http://localhost:9090") + "/api";
// The SAML redirect/ACS endpoints live outside the /api prefix (they're
// Spring Security's own SAML2 filter chain, not a REST controller), so we
// need the bare backend origin too — derived from API rather than a second
// hardcoded string, so the two can't silently drift apart.
const API_ORIGIN = API.replace(/\/api\/?$/, "");

// Translation keys, not literal text — see src/i18n/locales/en.json /
// es.json. Colors stay here since they're presentation, not translatable
// content.
const CHIP_KEYS = [
  { key: "ai",           color: "#6366f1" },
  { key: "goals",        color: "#8b5cf6" },
  { key: "boards",       color: "#06b6d4" },
  { key: "docs",         color: "#10b981" },
  { key: "collab",       color: "#f59e0b" },
  { key: "reports",      color: "#ec4899" },
  { key: "integrations", color: "#3b82f6" },
  { key: "rbac",         color: "#a855f7" },
];

const STAT_KEYS = [
  { num: "26+",  key: "aiFeatures" },
  { num: "14",   key: "modules" },
  { num: "8",    key: "integrations" },
  { num: "100%", key: "selfHosted" },
];

export default function Login() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [mode, setMode]   = useState("login");
  // Pre-fills when arriving from the "you're already a member — log in"
  // redirect on the Accept Invite page, so the person doesn't have to
  // retype the email they were just shown.
  const [form, setForm]   = useState({ name: "", email: searchParams.get("email") || "", password: "" });
  const [resetForm, setResetForm] = useState({ newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading,      setLoading]      = useState(false);
  // Two-step verification: set after the password step when the account has 2FA on.
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [twoFactorCode,  setTwoFactorCode]  = useState("");
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

  // Shared by the password step and the 2FA step: store the session, greet, go in.
  const finishLogin = async (res, greet) => {
    const { token, ...userData } = res.data;
    loginUser(userData, token);   // stores in sessionStorage + sets auth header

    // Brief, honest confirmation of what role/workspace the person is
    // entering as — previously login went straight to navigate("/") with
    // zero feedback about this at all. Best-effort: never blocks
    // navigation if the lookup fails or the account has no workspace yet
    // (e.g. a brand-new registration, which routes into workspace setup
    // instead, where the "you'll be the Owner" framing lives).
    if (greet) {
      try {
        const wsRes = await axios.get(`${API}/workspaces`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = Array.isArray(wsRes.data) ? wsRes.data : [];
        if (list.length > 0) {
          const primary = list[0];
          const roleLabel = {
            OWNER: t("login.roleOwner"), ADMIN: t("login.roleAdmin"),
            MEMBER: t("login.roleMember"), VIEWER: t("login.roleViewer"),
          }[primary.role] || primary.role || t("login.roleMember");
          const extra = list.length > 1 ? ` (+${list.length - 1})` : "";
          setSuccess(t("login.signedInAs", { role: roleLabel, workspace: primary.name }) + extra);
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch { /* best-effort only */ }
    }
    navigate("/");
  };

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const payload  = mode === "login"
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };
      const res = await axios.post(`${API}${endpoint}`, payload);
      if (res.data?.requiresTwoFactor) {
        // Password accepted, but this account also needs a code: no session exists yet.
        setTwoFactorToken(res.data.twoFactorToken);
        setTwoFactorCode("");
        setMode("twoFactor");
        return;
      }
      await finishLogin(res, mode === "login");
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
      if (res.data?.requiresTwoFactor) {
        setTwoFactorToken(res.data.twoFactorToken);
        setTwoFactorCode("");
        setMode("twoFactor");
        return;
      }
      await finishLogin(res, false);
    } catch (err) {
      setError(err.response?.data?.message || t("login.errors.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactor = async () => {
    if (!twoFactorCode.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/login/2fa`, { twoFactorToken, code: twoFactorCode.trim() });
      await finishLogin(res, true);
    } catch (err) {
      const message = err.response?.data?.message;
      if (err.response?.status === 401 && /expired/i.test(message || "")) {
        // The five-minute window after the password step ran out: start again.
        setMode("login");
        setTwoFactorToken("");
        setError(message);
      } else {
        setError(message || t("login.errors.genericFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (mode === "twoFactor") {
    return (
      <div className="auth-page">
        <div className="auth-right" style={{ margin: "0 auto", maxWidth: 440 }}>
          <div className="auth-right-inner">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <LanguageSwitcher />
            </div>
            <h2 className="auth-form-heading">{t("login.twoFactor.heading")}</h2>
            <p className="auth-form-sub">{t("login.twoFactor.subtitle")}</p>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <div className="auth-field">
              <label className="auth-field-label" htmlFor="two-factor-code">{t("login.twoFactor.codeLabel")}</label>
              <input id="two-factor-code" className="auth-input" type="text"
                autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} autoFocus
                placeholder="123456" value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleTwoFactor(); }} />
            </div>

            <button className="auth-submit" onClick={handleTwoFactor} disabled={loading || !twoFactorCode.trim()}>
              {loading ? t("login.twoFactor.verifying") : t("login.twoFactor.submit")}
            </button>

            <p className="auth-switch">
              <button className="auth-switch-btn"
                onClick={() => { setMode("login"); setError(""); setTwoFactorToken(""); setTwoFactorCode(""); }}>
                {t("login.twoFactor.back")}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const handleKey = (e) => { if (e.key === "Enter") handleSubmit(); };

  if (mode === "expiredReset") {
    return (
      <div className="auth-page">
        <div className="auth-right" style={{ margin: "0 auto", maxWidth: 440 }}>
          <div className="auth-right-inner">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <LanguageSwitcher />
            </div>
            <h2 className="auth-form-heading">{t("login.passwordExpired.heading")}</h2>
            <p className="auth-form-sub">{t("login.passwordExpired.subtitle")}</p>

            {error && <div className="auth-error">{error}</div>}

            <div className="auth-field">
              <label className="auth-field-label" htmlFor="reset-new-password">{t("login.passwordExpired.newPasswordLabel")}</label>
              <input id="reset-new-password" className="auth-input" type="password"
                placeholder="••••••••••" value={resetForm.newPassword}
                onChange={(e) => setResetForm(f => ({ ...f, newPassword: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleExpiredReset(); }} />
            </div>

            <div className="auth-field">
              <label className="auth-field-label" htmlFor="reset-confirm-password">{t("login.passwordExpired.confirmPasswordLabel")}</label>
              <input id="reset-confirm-password" className="auth-input" type="password"
                placeholder="••••••••••" value={resetForm.confirmPassword}
                onChange={(e) => setResetForm(f => ({ ...f, confirmPassword: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleExpiredReset(); }} />
            </div>

            <button className="auth-submit" onClick={handleExpiredReset} disabled={loading}>
              {loading ? t("login.pleaseWait") : t("login.passwordExpired.submit")}
            </button>

            <p className="auth-switch">
              <button className="auth-switch-btn"
                onClick={() => { setMode("login"); setError(""); setResetForm({ newPassword: "", confirmPassword: "" }); }}>
                {t("login.passwordExpired.backToSignIn")}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">

      {/* ── LEFT: Brand story ── */}
      <div className="auth-left">
        <div className="auth-left-top">

          {/* Brand */}
          <div className="auth-brand">
            <img src="/logo-icon.png" alt="" className="auth-brand-mark" />
            <span className="auth-brand-name">{t("common.appName")}</span>
          </div>

          {/* Headline */}
          <h1 className="auth-tagline">
            {t("login.tagline1")}<br />
            <span className="auth-tagline-accent">{t("login.taglineAccent")}</span>
          </h1>

          <p className="auth-desc">{t("login.description")}</p>

          {/* Feature chips */}
          <div className="auth-chips">
            {CHIP_KEYS.map((c) => (
              <div key={c.key} className="auth-chip">
                <span className="auth-chip-dot" style={{ background: c.color }} />
                {t(`login.chips.${c.key}`)}
              </div>
            ))}
          </div>
        </div>

        {/* Stats row */}
        <div className="auth-left-bottom">
          {STAT_KEYS.map((s, i) => (
            <Fragment key={s.key}>
              <div className="auth-stat">
                <span className="auth-stat-num">{s.num}</span>
                <span className="auth-stat-label">{t(`login.stats.${s.key}`)}</span>
              </div>
              {i < STAT_KEYS.length - 1 && <div className="auth-stat-divider" />}
            </Fragment>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Login form ── */}
      <div className="auth-right">
        <div className="auth-right-inner">

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
            <LanguageSwitcher />
          </div>

          <h2 className="auth-form-heading">
            {mode === "login" ? t("login.welcomeBack") : t("login.createAccountHeading")}
          </h2>
          <p className="auth-form-sub">
            {mode === "login" ? t("login.signInSubtitle") : t("login.registerSubtitle")}
          </p>

          {/* Mode toggle */}
          <div className="auth-mode-row">
            <button
              className={`auth-mode-btn ${mode === "login" ? "active" : ""}`}
              onClick={() => { setMode("login"); setError(""); }}
            >{t("login.signInTab")}</button>
            <button
              className={`auth-mode-btn ${mode === "register" ? "active" : ""}`}
              onClick={() => { setMode("register"); setError(""); }}
            >{t("login.createAccountTab")}</button>
          </div>

          {error   && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success" style={{color:"#10b981",fontSize:"13px",marginBottom:"8px"}}>{success}</div>}

          {mode === "register" && (
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="auth-name">{t("login.fullNameLabel")}</label>
              <input id="auth-name" className="auth-input" name="name" type="text"
                placeholder={t("login.fullNamePlaceholder")} value={form.name}
                onChange={handleChange} onKeyDown={handleKey} />
            </div>
          )}

          {mode === "register" && (
            <div className="auth-account-type-note">
              {t("login.accountTypeNote")}
            </div>
          )}

          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-email">{t("login.emailLabel")}</label>
            <input id="auth-email" className="auth-input" name="email" type="email"
              placeholder={t("login.emailPlaceholder")} value={form.email}
              onChange={handleChange} onKeyDown={handleKey} />
          </div>

          <div className="auth-field">
            <label className="auth-field-label" htmlFor="auth-password">{t("login.passwordLabel")}</label>
            <input id="auth-password" className="auth-input" name="password" type="password"
              placeholder="••••••••••" value={form.password}
              onChange={handleChange} onKeyDown={handleKey} />
          </div>

          <button className="auth-submit" onClick={handleSubmit} disabled={loading}>
            {loading
              ? t("login.pleaseWait")
              : mode === "login" ? t("login.signInSubmit") : t("login.createAccountSubmit")}
          </button>

          {mode === "login" && (
            <div className="auth-sso-section">
              <div className="auth-sso-divider"><span>{t("login.orSignInWith")}</span></div>

              {/* ── Magic link ── */}
              <button className="auth-sso-btn" type="button" onClick={async()=>{
                if (!form.email) return setError(t("login.enterEmailFirst"));
                try {
                  const client = (await import("../api/client")).default;
                  await client.post("/auth/magic-link",{email:form.email});
                  setSuccess(t("login.magicLinkSentSuccess"));
                } catch { setError(t("login.magicLinkFailed")); }
              }}>{t("login.magicLinkButton")}</button>

              {/* ── Social login & Auth0 SSO — only rendered once a real,
                   customer-supplied Auth0 tenant is configured via
                   VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID (see
                   src/config/auth0.js). In a production build that hasn't
                   set those, isAuth0Configured is false and this whole
                   block just doesn't render — never silently authenticates
                   real users against the shared development tenant. ── */}
              {isAuth0Configured && (
                <>
                  {/* Real OAuth via Auth0's federated connections, not a
                       self-asserted email. Each button deep-links into the
                       same Auth0 Universal Login flow used by "Continue
                       with Auth0 SSO" below, pre-selecting the matching
                       upstream provider. Requires that provider to be
                       enabled as a Social Connection in the Auth0
                       dashboard. Provider display names (Google/Microsoft/
                       GitHub) are proper nouns/brand names — deliberately
                       NOT translated, matching standard i18n practice for
                       third-party product names. */}
                  <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
                    {[
                      {p:"google-oauth2", label:"Google",    icon:"G", color:"#ea4335"},
                      {p:"windowslive",   label:"Microsoft",  icon:"⊞", color:"#00a4ef"},
                      {p:"github",        label:"GitHub",     icon:"⬡", color:"#24292e"},
                    ].map(({p,label,icon,color})=>(
                      <button key={p} type="button" style={{flex:1,padding:"9px 4px",
                        border:`1px solid ${color}44`,borderRadius:"8px",
                        background:`${color}10`,color,fontWeight:700,fontSize:"12px",cursor:"pointer"}}
                        onClick={() => auth0Login({ authorizationParams: { connection: p } })}>
                        {icon} {label}
                      </button>
                    ))}
                  </div>

                  <button className="auth-sso-btn" style={{marginTop:"8px"}}
                    onClick={() => auth0Login()} type="button">
                    <span className="auth-sso-icon">🔐</span>
                    {t("login.continueWithAuth0")}
                  </button>
                </>
              )}

              {/* ── Enterprise SAML SSO ──────────────────────────────
                   Only rendered once a workspace admin has actually wired
                   up a real IdP (see the effect above) — a full-page
                   redirect into Spring Security's own SAML2 flow, not an
                   axios call, since the IdP needs to see the browser
                   navigate there directly. */}
              {ssoProviders.length > 0 && (
                <>
                  <div className="auth-sso-divider" style={{marginTop:"14px"}}>
                    <span>{t("login.enterpriseSso")}</span>
                  </div>
                  {ssoProviders.map((provider) => (
                    <button key={provider.id} className="auth-sso-btn"
                      style={{marginTop:"8px"}} type="button"
                      onClick={() => {
                        window.location.href = `${API_ORIGIN}${provider.loginUrl}`;
                      }}>
                      <span className="auth-sso-icon">🏢</span>
                      {t("login.continueWithProvider", { provider: provider.label })}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="auth-divider">
            <div className="auth-divider-line" />
            <span className="auth-divider-text">
              {mode === "login" ? t("login.newToProwosma") : t("login.alreadyHaveAccount")}
            </span>
            <div className="auth-divider-line" />
          </div>

          <p className="auth-switch">
            <button className="auth-switch-btn"
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? t("login.createFreeAccount") : t("login.signInInstead")}
            </button>
          </p>

        </div>

        <div className="auth-right-footer">
          {t("login.footer", { year: new Date().getFullYear(), appName: t("common.appName") })}
        </div>
      </div>

    </div>
  );
}
