import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { apiErrorMessage } from "../utils/apiError";

import "../styles/pages/auth.css";
export default function MagicLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginUser, logoutUser } = useAuth();
  const verifiedToken = useRef(null);
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error,  setError]  = useState("");

  const token = params.get("token");

  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- validates the URL token synchronously; async branch below sets state after the API call
    if (!token) { setStatus("error"); setError("No token provided."); return; }

    // A magic-link token is SINGLE-USE — the backend clears it on the first
    // successful verify — so it must only ever be posted once. React.StrictMode
    // (see main.jsx) runs effects twice in development, and loginUser below
    // changes identity on every AuthProvider render; without this guard the
    // second post 401s ("Invalid or expired") right after the first one signed
    // the person in, and the page ends up on the error state.
    if (verifiedToken.current === token) return;
    verifiedToken.current = token;

    client.post("/auth/magic-link/verify", { token })
      .then(r => {
        // Establish a REAL session through AuthContext (same as Login and
        // Auth0Callback). Writing only the JWT to localStorage left AuthContext
        // with no user, so the navigate("/") below hit ProtectedRoute and was
        // sent straight back to /login. logoutUser() first so nothing from a
        // previous account in this tab (e.g. its active workspace) carries over.
        const { token: jwt, refreshToken, ...userData } = r.data;
        logoutUser();
        loginUser(userData, jwt);
        if (refreshToken) localStorage.setItem("refreshToken", refreshToken);
        setStatus("success");
        setTimeout(()=>navigate("/"), 1500);
      })
      .catch(e => {
        setStatus("error");
        setError(apiErrorMessage(e, "Invalid or expired magic link."));
      });
    // loginUser/logoutUser are recreated on every AuthProvider render; the ref
    // guard above is what makes re-running this effect safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[token, navigate]);

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"var(--bg-page,var(--gray-50))"}}>
      <div style={{background:"#fff",border:"1px solid var(--border,var(--border))",
        borderRadius:"16px",padding:"40px",maxWidth:360,width:"100%",textAlign:"center",
        boxShadow:"var(--elevation-2)"}}>
        <div style={{fontSize:"48px",marginBottom:"16px"}}>
          {status==="verifying"?"⏳":status==="success"?"✅":"❌"}
        </div>
        <h2 style={{fontSize:"20px",fontWeight:800,marginBottom:"8px",color:"var(--gray-800)"}}>
          {status==="verifying"?"Verifying your link…"
           :status==="success"?"Logged in!"
           :"Login failed"}
        </h2>
        <p style={{fontSize:"14px",color:"var(--gray-500)"}}>
          {status==="verifying"?"Please wait…"
           :status==="success"?"Redirecting to your workspace…"
           :error}
        </p>
        {status==="error" && (
          <button onClick={()=>navigate("/login")}
            style={{marginTop:"16px",padding:"10px 24px",background:"var(--brand-500)",color:"#fff",
              border:"none",borderRadius:"8px",fontWeight:700,cursor:"pointer",fontSize:"14px"}}>
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
