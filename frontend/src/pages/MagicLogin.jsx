import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import client from "../api/client";

import "../styles/pages/auth.css";
export default function MagicLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error,  setError]  = useState("");

  const token = params.get("token");

  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- validates the URL token synchronously; async branch below sets state after the API call
    if (!token) { setStatus("error"); setError("No token provided."); return; }
    client.post("/auth/magic-link/verify", { token })
      .then(r => {
        localStorage.setItem("token", r.data.token);
        if (r.data.refreshToken) localStorage.setItem("refreshToken", r.data.refreshToken);
        setStatus("success");
        setTimeout(()=>navigate("/"), 1500);
      })
      .catch(e => {
        setStatus("error");
        setError(e.response?.data?.error || "Invalid or expired magic link.");
      });
  },[token, navigate]);

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"var(--bg-page,#f8fafc)"}}>
      <div style={{background:"#fff",border:"1px solid var(--border,#e5e7eb)",
        borderRadius:"16px",padding:"40px",maxWidth:360,width:"100%",textAlign:"center",
        boxShadow:"0 4px 24px rgba(0,0,0,.06)"}}>
        <div style={{fontSize:"48px",marginBottom:"16px"}}>
          {status==="verifying"?"⏳":status==="success"?"✅":"❌"}
        </div>
        <h2 style={{fontSize:"20px",fontWeight:800,marginBottom:"8px",color:"#1e293b"}}>
          {status==="verifying"?"Verifying your link…"
           :status==="success"?"Logged in!"
           :"Login failed"}
        </h2>
        <p style={{fontSize:"14px",color:"#6b7280"}}>
          {status==="verifying"?"Please wait…"
           :status==="success"?"Redirecting to your workspace…"
           :error}
        </p>
        {status==="error" && (
          <button onClick={()=>navigate("/login")}
            style={{marginTop:"16px",padding:"10px 24px",background:"#6366f1",color:"#fff",
              border:"none",borderRadius:"8px",fontWeight:700,cursor:"pointer",fontSize:"14px"}}>
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
