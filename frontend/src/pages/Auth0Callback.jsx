import { useEffect, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import client from "../api/client";
import { getMyWorkspaces } from "../api/workspaces";

import "../styles/pages/auth.css";
export default function Auth0Callback() {
  const { isLoading, isAuthenticated, user, error, getIdTokenClaims } = useAuth0();
  const { loginUser } = useAuth();
  const navigate  = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading)         return;
    if (error)             { navigate("/login"); return; }
    if (!isAuthenticated)  { navigate("/login"); return; }
    if (attempted.current) return;
    attempted.current = true;

    // Send the real, signed ID token - the backend verifies it
    // cryptographically against Auth0's public keys before trusting
    // anything in it. Previously this just sent the locally-held
    // {email, name, sub} fields, which the backend accepted with no proof
    // they actually came from this Auth0 session.
    getIdTokenClaims()
      .then((claims) => {
        const idToken = claims?.__raw;
        if (!idToken) throw new Error("Could not get ID token from Auth0");
        return client.post("/auth/sso-login", { idToken });
      })
      .then(res => {
        const { token, ...userData } = res.data;
        loginUser(userData, token);
        // Auto-select workspace then navigate
        setTimeout(async () => {
          try {
            const wsRes = await getMyWorkspaces();
            const list  = wsRes.data || [];
            if (list.length > 0) {
              // setActiveWorkspace is not available here directly,
              // but ProtectedRoute will auto-select it
            }
          } catch { /* fall through — ProtectedRoute will auto-select a workspace */ }
          navigate("/");
        }, 150);
      })
      .catch(() => navigate("/login"));

  }, [isLoading, isAuthenticated, error, user, loginUser, navigate, getIdTokenClaims]);

  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", height:"100vh", gap:"16px",
    }}>
      <div style={{ fontSize:"32px" }}>🔐</div>
      <div style={{ fontSize:"16px", fontWeight:600, color:"var(--brand-500)" }}>
        Signing you in…
      </div>
      <div style={{ fontSize:"12px", color:"var(--gray-400)" }}>
        Please wait while we set up your session
      </div>
    </div>
  );
}
