import { resolveLogoUrl } from "../utils/logoUtils";

// Generate a consistent color from workspace name
function wsColor(name) {
  const colors = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6"];
  if (!name) return colors[0];
  return colors[name.split("").reduce((a,c) => a + c.charCodeAt(0), 0) % colors.length];
}

function WsAvatar({ name, logoUrl, size = 32, radius = 8, fontSize = 13 }) {
  const initials = name?.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase() || "WS";
  const logo = resolveLogoUrl(logoUrl);
  if (logo) {
    return <img src={logo} alt={name} style={{
      width: size, height: size, borderRadius: radius,
      objectFit: "cover", flexShrink: 0,
    }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: wsColor(name), color: "#fff",
      fontWeight: 700, fontSize, display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>{initials}</div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getMyWorkspaces } from "../api/workspaces";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";

export default function WorkspaceSwitcher() {
  const { activeWorkspace, setActiveWorkspace } = useAuth();
  const [open, setOpen]           = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [fullLogo, setFullLogo]   = useState(null); // logo from full workspace fetch
  const ref = useRef(null);
  const navigate = useNavigate();

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getMyWorkspaces();
        if (cancelled) return;
        const list = res.data;
        setWorkspaces(list);
        if (list.length === 0) { setActiveWorkspace(null); navigate("/workspace-setup"); }
        else if (!activeWorkspace) setActiveWorkspace(list[0]);
        else if (!list.some(ws => ws.id === activeWorkspace.id)) setActiveWorkspace(list[0]);
      } catch (e) { console.error("Failed to load workspaces:", e); }
    };
    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // Re-fetch list + logo when active workspace changes
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [listRes, fullRes] = await Promise.all([
          getMyWorkspaces(),
          client.get(`/workspaces/${activeWorkspace.id}`),
        ]);
        if (cancelled) return;
        setWorkspaces(listRes.data);
        const logo = fullRes.data?.logoUrl || null;
        setFullLogo(logo);
      } catch (e) { console.error(e); }
    };
    refresh();
    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handleSwitch = (ws) => {
    if (ws.id === activeWorkspace?.id) { setOpen(false); return; }
    setOpen(false);
    setActiveWorkspace(ws);
    navigate("/");
  };

  return (
    <div className="workspace-switcher" ref={ref}>
      <div className="workspace-selector" onClick={() => setOpen(o => !o)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setOpen(o => !o))?.(e); } }}>
        <WsAvatar name={activeWorkspace?.name} logoUrl={fullLogo || activeWorkspace?.logoUrl} size={32} />
        <div className="workspace-info">
          <div className="workspace-name">{activeWorkspace?.name || "Select Workspace"}</div>
          <div className="workspace-label">WORKSPACE</div>
        </div>
        <span className="workspace-chevron">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="workspace-dropdown">
          <div className="workspace-dropdown-header">YOUR WORKSPACES</div>

          {workspaces.length === 0 && (
            <div className="workspace-dropdown-empty">No workspaces found</div>
          )}

          {workspaces.map(ws => (
            <div key={ws.id}
              className={"workspace-option" + (activeWorkspace?.id === ws.id ? " active" : "")}
              onClick={() => handleSwitch(ws)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleSwitch(ws))?.(e); } }}>
              <WsAvatar name={ws.name} logoUrl={ws.logoUrl} size={30} radius={6} />
              <div className="workspace-option-name">{ws.name}</div>
              {activeWorkspace?.id === ws.id && <span className="workspace-active-check">✓</span>}
            </div>
          ))}

          <div className="workspace-dropdown-divider" />
          <div className="workspace-option workspace-create-btn" onClick={() => { setOpen(false); navigate("/workspace-setup"); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => { setOpen(false); navigate("/workspace-setup"); })?.(e); } }}>
            <div className="workspace-option-avatar" style={{ background:"rgba(255,255,255,0.1)" }}>+</div>
            <div className="workspace-option-name">Create New Workspace</div>
          </div>
        </div>
      )}
    </div>
  );
}
