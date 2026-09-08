import { compressImage, getBase64Size, migrateHeavyLogos } from "../utils/imageCompressor";
import { useState, useEffect, useRef } from "react";
import { unwrapList } from "../api/client";
import { useNavigate } from "react-router-dom";
import { getWorkspace, updateWorkspace, deleteWorkspace } from "../api/workspaces";
import { useAuth } from "../hooks/useAuth";
import { useRole } from "../hooks/useRole";
import { getTeamMembers, updateTeamMember } from "../api/team";
import client from "../api/client";
import PageHeader from "../components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import "../styles/pages/workspace.css";
const DATE_FORMATS = ["DD/MM/YYYY","MM/DD/YYYY","YYYY-MM-DD","DD-MM-YYYY","MMM DD, YYYY"];

const NOTIF_PREFS = [
  { key: "taskOverdue",      label: "Task Overdue Alerts",  desc: "Get notified when tasks pass their due date" },
  { key: "taskAssigned",     label: "Task Assignment",      desc: "Get notified when a task is assigned to you" },
  { key: "goalAchieved",     label: "Goal Achieved",        desc: "Celebrate when a goal reaches 100%" },
  { key: "projectCompleted", label: "Project Completed",    desc: "Get notified when a project is marked done" },
  { key: "weeklyDigest",     label: "Weekly Digest Email",  desc: "Receive a weekly summary email every Monday" },
];

function formatDate(date, fmt) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return fmt.replace("MMM", months[date.getMonth()]).replace("DD", d).replace("MM", m).replace("YYYY", y);
}

export default function WorkspaceSettings() {
  const { activeWorkspace, setActiveWorkspace } = useAuth();
  const { isOwner, isAdmin } = useRole();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [activeNav, setActiveNav] = useState("general");
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [success, setSuccess]     = useState("");
  const [error, setError]         = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [logoPreview, setLogoPreview]     = useState(null);

  // Admin delete state
  const [members, setMembers]             = useState([]);
  const [selectedMember, setSelectedMember]   = useState(null);
  const [showAdminDeleteModal, setShowAdminDeleteModal] = useState(false);
  const [adminDeleteConfirm, setAdminDeleteConfirm] = useState("");
  const [adminDeleteLoading, setAdminDeleteLoading] = useState(false);
  const [adminDeleteError, setAdminDeleteError]     = useState("");
  const [adminDeleteSuccess, setAdminDeleteSuccess] = useState("");

  // Usage stats state
  const [stats, setStats]             = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Invitations state
  const [invites, setInvites]         = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteForm, setInviteForm]   = useState({ email: "", role: "MEMBER" });
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [inviteError, setInviteError]   = useState("");

  // New feature state
  const [groups,      setGroups]      = useState([]);
  const [hierarchy,   setHierarchy]   = useState(null);
  const [wsTemplates, setWsTemplates] = useState([]);
  const [groupForm,   setGroupForm]   = useState({ name:"", description:"", color:"#6366f1", memberEmails:[], permissions:[] });
  const [newHoliday,  setNewHoliday]  = useState({ name:"", date:"", recurring:true, region:"ALL" });
  const [calForm,     setCalForm]     = useState({ workingDays:["MON","TUE","WED","THU","FRI"], fiscalYearStart:"01-01" });
  const [bulkEmails,  setBulkEmails]  = useState("");
  const [bulkRole,    setBulkRole]    = useState("MEMBER");
  const [guestEmail,  setGuestEmail]  = useState("");
  const [permMatrix,  setPermMatrix]  = useState(null);

  const [form, setForm] = useState({
    name: "", logoUrl: "", timezone: "UTC", dateFormat: "DD/MM/YYYY", dataRegion: "UNSET",
    notifPrefs: { taskOverdue: true, taskAssigned: true, goalAchieved: true, projectCompleted: true, weeklyDigest: false },
  });
  const [residency, setResidency] = useState(null);

  const timezones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC","America/New_York","Europe/London","Asia/Kolkata","Asia/Tokyo"];

  // Load groups when groups tab opened
  useEffect(()=>{
    if (activeNav==="groups") {
      client.get("/workspace/groups").then(r=>setGroups(unwrapList(r))).catch(()=>{});
    }
    if (activeNav==="templates") {
      client.get("/workspace/templates").then(r=>setWsTemplates(unwrapList(r))).catch(()=>{});
    }
    if (activeNav==="permissions") {
      client.get("/workspace/permissions/matrix").then(r=>setPermMatrix(r.data)).catch(()=>{});
    }
  },[activeNav]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const load = async () => {
      setLoading(true);
      try {
        const [wsRes, membersRes] = await Promise.all([
          getWorkspace(activeWorkspace.id),
          getTeamMembers(),
        ]);
        const ws = wsRes.data;
        setForm({
          name: ws.name || "", logoUrl: ws.logoUrl || "",
          timezone: ws.timezone || "UTC", dateFormat: ws.dateFormat || "DD/MM/YYYY",
          dataRegion: ws.dataRegion || "UNSET",
          notifPrefs: ws.notifPrefs || { taskOverdue: true, taskAssigned: true, goalAchieved: true, projectCompleted: true, weeklyDigest: false },
        });
        client.get("/admin/data-residency").then(r => setResidency(r.data)).catch(() => {});
        setLogoPreview(ws.logoUrl || null);
        
        // Silently recompress heavy base64 logos in background
        if (ws.logoUrl && ws.logoUrl.startsWith('data:')) {
          const { bytes } = getBase64Size(ws.logoUrl);
          if (bytes > 35000) {
            migrateHeavyLogos([ws], async (wsId, data) => {
              await import('../api/workspaces').then(m => m.updateWorkspace(wsId, data));
              // Update local state too
              setLogoPreview(data.logoUrl);
              set('logoUrl', data.logoUrl);
            }).catch(() => {});
          }
        }
        setMembers(unwrapList(membersRes));
      } catch { setError("Failed to load workspace settings"); }
      finally { setLoading(false); }
    };
    load();
  }, [activeWorkspace?.id]);

  const loadInvites = async () => {
    if (!activeWorkspace?.id) return;
    setInvitesLoading(true);
    try {
      const res = await client.get(`/invitations?workspaceId=${activeWorkspace.id}`);
      setInvites(unwrapList(res));
    } catch (e) { console.error(e); }
    finally { setInvitesLoading(false); }
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email.trim()) return;
    setInviteSending(true); setInviteError(""); setInviteSuccess("");
    try {
      await client.post("/invitations", {
        email: inviteForm.email.trim(),
        role:  inviteForm.role,
        workspaceId: activeWorkspace.id,
      });
      setInviteSuccess(`Invite sent to ${inviteForm.email}`);
      setInviteForm({ email: "", role: "MEMBER" });
      loadInvites();
    } catch (e) {
      setInviteError(e.response?.data?.message || "Failed to send invite");
    } finally { setInviteSending(false); }
  };

  const handleCancelInvite = async (id) => {
    try {
      await client.delete(`/invitations/${id}`);
      setInvites(prev => prev.filter(i => i.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleResendInvite = async (id) => {
    try {
      await client.post(`/invitations/${id}/resend`);
      setInviteSuccess("Invitation resent!");
      setTimeout(() => setInviteSuccess(""), 3000);
    } catch (e) { console.error(e); }
  };

  const handleRoleChange = async (member, newRole) => {
    try {
      await updateTeamMember(member.id, { ...member, role: newRole });
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    } catch (e) { console.error(e); }
  };

  const loadStats = async () => {
    if (!activeWorkspace?.id || stats) return;
    setStatsLoading(true);
    try {
      const res = await client.get(`/workspaces/${activeWorkspace.id}/stats`);
      setStats(res.data || {});
    } catch (e) { console.error(e); }
    finally { setStatsLoading(false); }
  };

  const setNotif = (k, v) => setForm((f) => ({ ...f, notifPrefs: { ...f.notifPrefs, [k]: v } }));

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    try {
      // Compress to max 200×200px JPEG ~30KB regardless of original size
      const compressed = await compressImage(file);
      const info = getBase64Size(compressed);
      console.log(`Logo compressed: ${info.kb}KB`);
      setLogoPreview(compressed);
      set("logoUrl", compressed);
    } catch {
      setError("Failed to process image. Please try a different file.");
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Workspace name is required"); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const res = await updateWorkspace(activeWorkspace.id, {
        name: form.name.trim(), logoUrl: form.logoUrl || null,
        timezone: form.timezone, dateFormat: form.dateFormat, dataRegion: form.dataRegion,
        notifPrefs: form.notifPrefs,
      });
      // Was unwrapList(res) — that helper only ever returns an array, and
      // this endpoint returns the updated Workspace object directly, not a
      // list. Every save was silently setting the app's active-workspace
      // state to [], not the actual updated workspace.
      setActiveWorkspace(res.data);
      client.get("/admin/data-residency").then(r => setResidency(r.data)).catch(() => {});
      setSuccess("Settings saved!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) { setError(e.response?.data?.message || "Failed to save settings"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== form.name) { setError(`Type "${form.name}" to confirm`); return; }
    setDeleteLoading(true); setError("");
    try {
      await deleteWorkspace(activeWorkspace.id);
      setActiveWorkspace(null);
      navigate("/workspace-setup");
    } catch (e) {
      setError(e.response?.data?.message || "Failed to delete workspace");
      setDeleteLoading(false);
    }
  };

  const openAdminDeleteModal = (member) => {
    setSelectedMember(member); setAdminDeleteConfirm("");
    setAdminDeleteError(""); setAdminDeleteSuccess(""); setShowAdminDeleteModal(true);
  };

  const handleAdminDelete = async () => {
    if (!selectedMember) return;
    if (adminDeleteConfirm !== selectedMember.email) { setAdminDeleteError("Type the email exactly"); return; }
    setAdminDeleteLoading(true); setAdminDeleteError("");
    try {
      await client.delete("/users/admin/delete", { data: { email: selectedMember.email } });
      setAdminDeleteSuccess(`${selectedMember.name} deleted successfully.`);
      setMembers((prev) => prev.filter((m) => m.email !== selectedMember.email));
      setAdminDeleteConfirm(""); setSelectedMember(null);
      setTimeout(() => { setShowAdminDeleteModal(false); setAdminDeleteSuccess(""); }, 2500);
    } catch (e) {
      setAdminDeleteError(e.response?.data?.message || "Failed to delete user");
    } finally { setAdminDeleteLoading(false); }
  };

  if (loading) {
    return (
      <div>
        <PageHeader icon="⚙️" title="Workspace Settings" description="Configure your workspace" />
        <div className="empty-state">Loading settings...</div>
      </div>
    );
  }

  const navItems = [
    { key: "general",      label: "General",        icon: "🏢" },
    { key: "preferences",  label: "Preferences",    icon: "🔔" },
    { key: "locale",       label: "Language",       icon: "🌐" },
    { key: "calendar",     label: "Business Calendar", icon: "📅" },
    { key: "members",      label: "Members",        icon: "👥" },
    { key: "groups",       label: "User Groups",    icon: "👤" },
    { key: "permissions",  label: "Permissions",    icon: "🔐" },
    { key: "hierarchy",    label: "Org Hierarchy",  icon: "🏗" },
    { key: "templates",    label: "WS Templates",   icon: "📋" },
    { key: "crossaccess",  label: "Cross-Access",   icon: "🔗" },
    { key: "usage",        label: "Usage & Stats",  icon: "📊" },
      { key: "new-workspace", label: "New Workspace", icon: "➕" },
    ...(isOwner ? [{ key: "danger", label: "Danger Zone", icon: "⚠️", danger: true }] : []),
  ];

  return (
    <div>
      <PageHeader
        icon="⚙️"
        title="Workspace Settings"
        description="Configure your workspace"
        action={
          (activeNav === "general" || activeNav === "preferences") && (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "⏳ Saving..." : "💾 Save Changes"}
            </button>
          )
        }
      />

      {success && <div className="settings-success-banner">✅ {success}</div>}
      {error   && <div className="settings-error-banner">⚠️ {error}</div>}

      {/* ── Option C: Left sidebar + content ── */}
      <div className="ws-settings-layout">

        {/* Left nav */}
        <div className="ws-settings-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={"ws-settings-nav-item" +
                (activeNav === item.key ? " active" : "") +
                (item.danger ? " danger" : "")}
              onClick={() => {
                setActiveNav(item.key);
                setError(""); setSuccess("");
                if (item.key === "usage") loadStats();
                if (item.key === "members") loadInvites();
                if (item.key === "groups") {
                  client.get("/workspace/groups").then(r=>setGroups(unwrapList(r))).catch(()=>{});
                }
                if (item.key === "templates") {
                  client.get("/workspace/templates").then(r=>setWsTemplates(unwrapList(r))).catch(()=>{});
                }
                if (item.key === "permissions") {
                  client.get("/workspace/permissions/matrix").then(r=>setPermMatrix(r.data)).catch(()=>{});
                }
              }}
            >
              <span className="ws-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="ws-settings-content">

          {/* ── GENERAL ── */}
          {activeNav === "general" && (
            <div>
              <div className="settings-section">
                <div className="settings-section-title">General</div>
                <div className="settings-two-col">
                  <div>
                    <div className="form-group">
                      <label htmlFor={"workspace-settings-workspace-name"}>Workspace Name *</label>
                      <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Acme Corp" id={"workspace-settings-workspace-name"} />
                    </div>
                    <div className="form-group">
                      <label htmlFor={"workspace-settings-timezone"}>Timezone</label>
                      <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} id={"workspace-settings-timezone"}>
                        {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor={"workspace-settings-logo-url"}>Logo URL</label>
                      <input
                        value={form.logoUrl && form.logoUrl.startsWith("data:") ? "" : form.logoUrl}
                        onChange={(e) => { set("logoUrl", e.target.value); setLogoPreview(e.target.value || null); }}
                        placeholder="https://yourcompany.com/logo.png" id={"workspace-settings-logo-url"}
                      />
                      <div className="settings-logo-upload-row">
                        <span style={{ fontSize: "12px", color: "var(--gray-400)" }}>or</span>
                        <button className="btn-secondary" style={{ fontSize: "12px", padding: "5px 12px" }}
                          onClick={() => fileInputRef.current?.click()}>
                          📁 Upload File
                        </button>
                        {form.logoUrl && (
                          <button className="btn-secondary"
                            style={{ fontSize: "12px", padding: "5px 12px", color: "var(--danger)" }}
                            onClick={() => { set("logoUrl", ""); setLogoPreview(null); }}>
                            Remove
                          </button>
                        )}
                        <input ref={fileInputRef} type="file" accept="image/*"
                          style={{ display: "none" }} onChange={handleFileChange} />
                      </div>
                    </div>
                  </div>
                  <div className="settings-logo-preview-col">
                    <div className="settings-logo-preview">
                      {logoPreview
                        ? <img src={logoPreview} alt="Workspace logo" className="settings-logo-img" onError={() => setLogoPreview(null)} />
                        : <div className="settings-logo-placeholder">
                            <div style={{ fontSize: "36px" }}>🏢</div>
                            <span style={{ fontSize: "11px", color: "var(--gray-400)", marginTop: "6px" }}>No logo</span>
                          </div>
                      }
                    </div>
                    <p className="settings-logo-hint">Recommended: 200×200px PNG or SVG</p>
                  </div>
                </div>
              </div>
            <div style={{marginTop:20,padding:"20px 24px",background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.18)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
              <div>
                <div style={{fontWeight:800,fontSize:14,color:"var(--gray-800)",marginBottom:4}}>Create another workspace</div>
                <div style={{fontSize:12,color:"var(--gray-500)",lineHeight:1.5}}>Set up a workspace for a different team or project.</div>
              </div>
              <button className="btn-primary" style={{flexShrink:0,padding:"9px 20px",fontSize:13}} onClick={()=>navigate("/workspace-setup")}>+ New workspace</button>
            </div>

            {/* ── Data Residency ──────────────────────────────────
                Declarative only — see the backend's Workspace.dataRegion
                doc comment. Selecting a region here records a commitment
                and shows whether this deployment actually matches it; it
                does not itself move any data. */}
            <div className="settings-section">
              <div className="settings-section-title">Data Residency</div>
              <div className="form-group" style={{ maxWidth: "320px" }}>
                <label htmlFor={"workspace-settings-declared-data-region"}>Declared data region</label>
                <select value={form.dataRegion} onChange={(e) => set("dataRegion", e.target.value)} id={"workspace-settings-declared-data-region"}>
                  <option value="UNSET">Not declared</option>
                  <option value="US">United States</option>
                  <option value="EU">European Union</option>
                  <option value="UK">United Kingdom</option>
                  <option value="APAC">Asia-Pacific</option>
                </select>
              </div>
              {residency && (
                <div style={{
                  marginTop: 8, padding: "12px 14px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
                  background: residency.matches ? "rgba(16,185,129,.08)" : "rgba(239,68,68,.08)",
                  border: `1px solid ${residency.matches ? "rgba(16,185,129,.25)" : "rgba(239,68,68,.25)"}`,
                  color: residency.matches ? "#047857" : "#b91c1c",
                }}>
                  {residency.matches ? "✅ " : "⚠️ "}{residency.message}
                </div>
              )}
            </div>
            </div>
          )}

          {/* ── PREFERENCES ── */}
          {activeNav === "preferences" && (
            <div>
              <div className="settings-section">
                <div className="settings-section-title">Preferences</div>
                <div className="form-group" style={{ maxWidth: "320px" }}>
                  <label htmlFor={"workspace-settings-date-format"}>Date Format</label>
                  <select value={form.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} id={"workspace-settings-date-format"}>
                    {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <span style={{ fontSize: "11px", color: "var(--gray-400)", marginTop: "4px", display: "block" }}>
                    Preview: {formatDate(new Date(), form.dateFormat)}
                  </span>
                </div>
                <div className="settings-section-subtitle">Notification Preferences</div>
                <div className="settings-notif-list">
                  {NOTIF_PREFS.map((pref) => (
                    <div key={pref.key} className="settings-notif-row">
                      <div className="settings-notif-info">
                        <div className="settings-notif-label">{pref.label}</div>
                        <div className="settings-notif-desc">{pref.desc}</div>
                      </div>
                      <div
                        className={"settings-toggle" + (form.notifPrefs[pref.key] ? " on" : "")}
                        onClick={() => setNotif(pref.key, !form.notifPrefs[pref.key])} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setNotif(pref.key, !form.notifPrefs[pref.key]))?.(e); } }}
                      >
                        <div className="settings-toggle-knob" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Quiet Hours ── */}
              <div className="settings-section">
                <div className="settings-section-title">🌙 Quiet Hours</div>
                <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"12px"}}>
                  Suppress notifications during these hours. Users won't receive alerts until quiet hours end.
                </p>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor={"workspace-settings-quiet-hours-start"}>Quiet Hours Start</label>
                    <input type="time" value={form.quietHoursStart||""}
                      onChange={e=>set("quietHoursStart",e.target.value)} id={"workspace-settings-quiet-hours-start"} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={"workspace-settings-quiet-hours-end"}>Quiet Hours End</label>
                    <input type="time" value={form.quietHoursEnd||""}
                      onChange={e=>set("quietHoursEnd",e.target.value)} id={"workspace-settings-quiet-hours-end"} />
                  </div>
                </div>
                <div className="form-group">
                  <span className="field-label">Quiet Days (tick to suppress notifications)</span>
                  <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginTop:"6px"}}>
                    {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d=>{
                      const quietDays = form.quietDays||[];
                      const active = quietDays.includes(d);
                      return (
                        <label key={d} style={{display:"flex",alignItems:"center",gap:"4px",cursor:"pointer",
                          padding:"5px 12px",borderRadius:"99px",fontSize:"12px",fontWeight:700,
                          border:"1px solid var(--border)",
                          background:active?"rgba(99,102,241,.1)":"var(--bg-card)",
                          color:active?"#6366f1":"var(--gray-600)",userSelect:"none"}}>
                          <input type="checkbox" style={{display:"none"}} checked={active}
                            onChange={()=>set("quietDays",active
                              ?quietDays.filter(x=>x!==d):[...quietDays,d])} />
                          {d}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="admin-field-help">
                  Notifications sent during quiet hours will be held and delivered when quiet hours end.
                </div>
              </div>
            </div>
          )}

          {/* ── USAGE & STATS ── */}
          {/* ── Members & Invitations tab ── */}
          {activeNav === "members" && (
            <div className="settings-content">
              {/* Invite new member */}
              {(isOwner || isAdmin) && (
                <div className="settings-section">
                  <div className="settings-section-title">✉️ Invite a Member</div>
                  <p style={{ fontSize:"13px", color:"var(--gray-500)", marginBottom:"14px" }}>
                    Invite someone by email. They'll receive a link to join this workspace.
                  </p>
                  {inviteSuccess && <div className="settings-success-banner">✅ {inviteSuccess}</div>}
                  {inviteError   && <div className="settings-error-banner">⚠️ {inviteError}</div>}
                  <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", alignItems:"flex-end" }}>
                    <div className="form-group" style={{ flex:1, minWidth:"220px", marginBottom:0 }}>
                      <label htmlFor={"workspace-settings-email-address"}>Email address</label>
                      <input
                        type="email"
                        value={inviteForm.email}
                        onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && handleSendInvite()}
                        placeholder="colleague@company.com" id={"workspace-settings-email-address"}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label htmlFor={"workspace-settings-role"}>Role</label>
                      <select value={inviteForm.role}
                        onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
                        style={{ minWidth:"130px" }} id={"workspace-settings-role"}>
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                        <option value="VIEWER">Viewer (read-only)</option>
                      </select>
                    </div>
                    <button className="btn-primary"
                      style={{ height:"38px", padding:"0 18px" }}
                      disabled={inviteSending || !inviteForm.email.trim()}
                      onClick={handleSendInvite}>
                      {inviteSending ? "⏳ Sending…" : "📨 Send Invite"}
                    </button>
                  </div>
                </div>
              )}

              {/* Current members with role change */}
              <div className="settings-section">
                <div className="settings-section-title">👥 Current Members</div>
                {members.length === 0 ? (
                  <p className="empty-state" style={{ padding:"16px 0", textAlign:"left" }}>No members yet.</p>
                ) : (
                  <div className="ws-member-list">
                    {members.map(member => {
                      const initials = member.name?.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() || "?";
                      const isCurrentOwner = member.email === activeWorkspace?.ownerEmail;
                      return (
                        <div key={member.id} className="ws-member-row">
                          <div className="ws-member-avatar" style={{ background: member.color || "#6366f1" }}>{initials}</div>
                          <div className="ws-member-info">
                            <div className="ws-member-name">
                              {member.name || member.email}
                              {isCurrentOwner && <span className="ws-owner-badge">Owner</span>}
                            </div>
                            <div className="ws-member-email">{member.email}</div>
                          </div>
                          {(isOwner || isAdmin) && !isCurrentOwner ? (
                            <select
                              className="ws-role-select"
                              value={member.role || "MEMBER"}
                              onChange={e => handleRoleChange(member, e.target.value)}
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                            </select>
                          ) : (
                            <span className={"role-badge role-" + (member.role||"member").toLowerCase()}>
                              {member.role || "MEMBER"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pending invitations */}
              <div className="settings-section">
                <div className="settings-section-title">⏳ Pending Invitations</div>
                {invitesLoading ? (
                  <p className="empty-state" style={{ padding:"12px 0", textAlign:"left" }}>Loading…</p>
                ) : invites.filter(i => i.status === "PENDING").length === 0 ? (
                  <p style={{ fontSize:"13px", color:"var(--gray-400)" }}>No pending invitations.</p>
                ) : (
                  <div className="ws-member-list">
                    {invites.filter(i => i.status === "PENDING").map(inv => (
                      <div key={inv.id} className="ws-member-row">
                        <div className="ws-member-avatar" style={{ background:"var(--gray-300)", color:"var(--gray-600)" }}>
                          {inv.email?.slice(0,2).toUpperCase()}
                        </div>
                        <div className="ws-member-info">
                          <div className="ws-member-name">{inv.email}</div>
                          <div className="ws-member-email">
                            Invited {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : ""}
                          </div>
                        </div>
                        <span className={"role-badge role-" + (inv.role||"member").toLowerCase()}>
                          {inv.role || "MEMBER"}
                        </span>
                        <div style={{ display:"flex", gap:"6px" }}>
                          <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px" }}
                            onClick={() => handleResendInvite(inv.id)}>
                            🔄 Resend
                          </button>
                          <button className="btn-secondary" style={{ fontSize:"11px", padding:"4px 10px", color:"var(--danger)" }}
                            onClick={() => handleCancelInvite(inv.id)}>
                            ✕ Cancel
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeNav === "usage" && (
            <div>
              {statsLoading ? (
                <div className="empty-state">📊 Loading stats...</div>
              ) : !stats ? (
                <div className="empty-state">No stats available yet</div>
              ) : (
                <div>
                  <div className="usage-stats-grid">
                    {[
                      { label: "Projects",        value: stats.projects,  icon: "📁", color: "#6366f1" },
                      { label: "Tasks",           value: stats.tasks,     icon: "✅", color: "#10b981" },
                      { label: "Goals",           value: stats.goals,     icon: "🎯", color: "#f59e0b" },
                      { label: "Members",         value: stats.members,   icon: "👥", color: "#3b82f6" },
                      { label: "Storage",         value: (stats.storageMB ?? 0) + " MB", icon: "💾", color: "#8b5cf6" },
                      { label: "Activities (30d)", value: stats.activityTrend?.reduce((s, d) => s + d.activity, 0), icon: "📋", color: "#ec4899" },
                    ].map((s) => (
                      <div key={s.label} className="usage-stat-card" style={{ borderLeft: "4px solid " + s.color }}>
                        <div className="usage-stat-icon">{s.icon}</div>
                        <div>
                          <div className="usage-stat-value" style={{ color: s.color }}>{s.value}</div>
                          <div className="usage-stat-label">{s.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="settings-section" style={{ marginTop: "20px" }}>
                    <div className="settings-section-title">Task Breakdown</div>
                    <div style={{ display: "flex", gap: "12px" }}>
                      {[
                        { label: "To Do",       value: stats.tasksTodo,       color: "#6366f1" },
                        { label: "In Progress", value: stats.tasksInProgress, color: "#f59e0b" },
                        { label: "Done",        value: stats.tasksDone,       color: "#10b981" },
                      ].map((s) => (
                        <div key={s.label} style={{
                          flex: 1, background: s.color + "15", border: "1px solid " + s.color + "40",
                          borderRadius: "var(--radius-md)", padding: "14px", textAlign: "center"
                        }}>
                          <div style={{ fontSize: "28px", fontWeight: 800, color: s.color }}>{s.value}</div>
                          <div style={{ fontSize: "12px", color: "var(--gray-500)", marginTop: "4px" }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="settings-section" style={{ marginTop: "20px" }}>
                    <div className="settings-section-title">Activity — Last 30 Days</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.activityTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--gray-400)" }} interval={4} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--gray-400)" }} />
                        <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }} />
                        <Bar dataKey="activity" fill="#6366f1" radius={[4, 4, 0, 0]} name="Actions" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <button className="btn-secondary" style={{ marginTop: "8px", fontSize: "12px" }}
                    onClick={() => { setStats(null); loadStats(); }}>
                    🔄 Refresh Stats
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── DANGER ZONE (OWNER only) ── */}
          {activeNav === "new-workspace" && (
            <div className="settings-section">
              <div className="settings-section-title">➕ Create New Workspace</div>
              <p style={{fontSize:14,color:"var(--gray-500)",marginBottom:20,lineHeight:1.6}}>
                Create a new workspace for a different team, department, or project.
                Each workspace is completely separate with its own members, projects, and settings.
              </p>
              <button
                className="btn-primary"
                style={{display:"flex",alignItems:"center",gap:8,fontSize:14,padding:"10px 22px"}}
                onClick={() => navigate("/workspace-setup")}>
                ⚡ Create new workspace
              </button>
              <div style={{marginTop:28,padding:"16px 20px",background:"var(--gray-50)",
                borderRadius:10,border:"1px solid var(--border)"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"var(--gray-700)"}}>
                  Workspace templates available
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[
                    {icon:"💻",name:"Software Delivery",desc:"Sprints, DORA, Kanban"},
                    {icon:"📊",name:"PMO / Portfolio",  desc:"RAID, KPIs, ROI Engine"},
                    {icon:"🏗",name:"Enterprise",        desc:"BPM, Roadmap, Decisions"},
                    {icon:"🎯",name:"Agile Product",     desc:"OKRs, Epics, Backlog"},
                    {icon:"📚",name:"Knowledge Hub",     desc:"Docs, SOPs, Meetings"},
                    {icon:"⬜",name:"Blank",             desc:"Start from scratch"},
                  ].map(t => (
                    <div key={t.name}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",
                        background:"var(--bg-card)",border:"1px solid var(--border)",
                        borderRadius:8,cursor:"pointer",transition:"all .12s"}}
                      onClick={() => navigate("/workspace-setup")}
                      onMouseEnter={e=>e.currentTarget.style.borderColor="#6366f1"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate("/workspace-setup"))?.(e); } }}>
                      <span style={{fontSize:20}}>{t.icon}</span>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--gray-800)"}}>{t.name}</div>
                        <div style={{fontSize:11,color:"var(--gray-400)"}}>{t.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeNav === "danger" && isOwner && (
            <div>
              {/* Delete workspace */}
              <div className="settings-section settings-danger-section">
                <div className="settings-section-title settings-danger-title">🗑️ Delete Workspace</div>
                <div className="settings-danger-body">
                  <div>
                    <div className="settings-danger-label">Permanently delete this workspace</div>
                    <div className="settings-danger-desc">
                      Deletes all projects, tasks, goals, members and data.
                      <strong> This cannot be undone.</strong>
                    </div>
                  </div>
                  <div className="settings-delete-confirm">
                    <label style={{ fontSize: "13px", color: "var(--gray-600)", marginBottom: "6px", display: "block" }}>
                      Type <strong>{form.name}</strong> to confirm:
                    </label>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder={form.name}
                        style={{ maxWidth: "240px", borderColor: deleteConfirm === form.name && deleteConfirm ? "#10b981" : undefined }} />
                      <button className="btn-danger"
                        disabled={deleteLoading || deleteConfirm !== form.name}
                        onClick={handleDelete}>
                        {deleteLoading ? "⏳ Deleting..." : "🗑️ Delete Workspace"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Admin delete members */}
              <div className="settings-section settings-danger-section" style={{ marginTop: "16px" }}>
                <div className="settings-section-title settings-danger-title">🛡️ Delete Member Accounts</div>
                <div className="settings-danger-desc" style={{ marginBottom: "16px" }}>
                  Permanently delete a member's account and all their owned data.
                </div>
                {members.filter((m) => m.email !== activeWorkspace?.ownerEmail).length === 0 ? (
                  <div className="empty-state" style={{ padding: "16px 0", textAlign: "left" }}>No other members in this workspace.</div>
                ) : (
                  <div className="admin-delete-member-list">
                    {members.filter((m) => m.email !== activeWorkspace?.ownerEmail).map((member) => {
                      const initials = member.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?";
                      return (
                        <div key={member.id} className="admin-delete-member-row">
                          <div className="admin-delete-avatar" style={{ background: member.color || "#6366f1" }}>{initials}</div>
                          <div className="admin-delete-info">
                            <div className="admin-delete-name">{member.name}</div>
                            <div className="admin-delete-email">{member.email}</div>
                          </div>
                          <select
                            className="ws-role-select"
                            value={member.role || "MEMBER"}
                            onChange={e => handleRoleChange(member, e.target.value)}
                          >
                            <option value="ADMIN">Admin</option>
                            <option value="MEMBER">Member</option>
                            <option value="VIEWER">Viewer</option>
                          </select>
                          <button className="btn-danger" style={{ fontSize: "12px", padding: "5px 14px" }}
                            onClick={() => openAdminDeleteModal(member)}>
                            🗑️ Delete
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}


          {/* ── Language / Locale tab ── */}
          {activeNav === "locale" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">🌐 Language &amp; Locale</h3>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor={"workspace-settings-language"}>Language</label>
                  <select value={form.language||"en"} onChange={e=>setForm(f=>({...f,language:e.target.value}))} id={"workspace-settings-language"}>
                    {[["en","English"],["fr","Français"],["de","Deutsch"],["es","Español"],["ja","日本語"],["zh","中文"],["ar","العربية"],["pt","Português"],["hi","हिन्दी"]].map(([v,l])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor={"workspace-settings-locale"}>Locale</label>
                  <select value={form.locale||"en-GB"} onChange={e=>setForm(f=>({...f,locale:e.target.value}))} id={"workspace-settings-locale"}>
                    {[["en-GB","English (UK)"],["en-US","English (US)"],["fr-FR","French"],["de-DE","German"],["es-ES","Spanish"],["ja-JP","Japanese"],["zh-CN","Chinese (Simplified)"],["pt-BR","Portuguese (Brazil)"],["ar-SA","Arabic"],["hi-IN","Hindi"]].map(([v,l])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor={"workspace-settings-currency"}>Currency</label>
                  <select value={form.currency||"USD"} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} id={"workspace-settings-currency"}>
                    {[["USD","USD ($)"],["GBP","GBP (£)"],["EUR","EUR (€)"],["JPY","JPY (¥)"],["INR","INR (₹)"],["AUD","AUD (A$)"],["CAD","CAD (C$)"],["SGD","SGD (S$)"]].map(([v,l])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "💾 Save Language Settings"}
              </button>
            </div>
          )}

          {/* ── Business Calendar tab ── */}
          {activeNav === "calendar" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">📅 Business Calendar</h3>
              <div className="form-group">
                <span className="field-label">Working Days</span>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginTop:"8px"}}>
                  {["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d=>(
                    <label key={d} style={{display:"flex",alignItems:"center",gap:"4px",cursor:"pointer",
                      padding:"6px 12px",borderRadius:"99px",border:"1px solid var(--border)",
                      background:calForm.workingDays.includes(d)?"#6366f1":"var(--bg-card)",
                      color:calForm.workingDays.includes(d)?"#fff":"var(--gray-600)",
                      fontWeight:700,fontSize:"12px",userSelect:"none"}}>
                      <input type="checkbox" style={{display:"none"}} checked={calForm.workingDays.includes(d)}
                        onChange={()=>setCalForm(f=>({...f,workingDays:f.workingDays.includes(d)
                          ?f.workingDays.filter(x=>x!==d):[...f.workingDays,d]}))} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor={"workspace-settings-fiscal-year-start-mm-dd"}>Fiscal Year Start (MM-DD)</label>
                  <input value={calForm.fiscalYearStart} style={{maxWidth:160}}
                    onChange={e=>setCalForm(f=>({...f,fiscalYearStart:e.target.value}))}
                    placeholder="01-01" id={"workspace-settings-fiscal-year-start-mm-dd"} />
                  <div className="admin-field-help">e.g. "04-01" = April 1st fiscal year</div>
                </div>
              </div>
              <button className="btn-primary" style={{marginBottom:"20px"}} onClick={async()=>{
                await client.patch(`/workspaces/${activeWorkspace.id}/calendar`, calForm);
                setSuccess("Business calendar saved");
              }}>💾 Save Calendar</button>

              <div style={{fontWeight:700,fontSize:"13px",marginBottom:"10px"}}>🎉 Public Holidays</div>
              <div className="form-row">
                <div className="form-group" style={{flex:2}}>
                  <label htmlFor={"workspace-settings-name"}>Name</label>
                  <input value={newHoliday.name} onChange={e=>setNewHoliday(h=>({...h,name:e.target.value}))}
                    placeholder="e.g. Christmas Day" id={"workspace-settings-name"} />
                </div>
                <div className="form-group">
                  <label htmlFor={"workspace-settings-date-mm-dd"}>Date (MM-DD)</label>
                  <input value={newHoliday.date} onChange={e=>setNewHoliday(h=>({...h,date:e.target.value}))}
                    placeholder="12-25" id={"workspace-settings-date-mm-dd"} />
                </div>
                <div className="form-group">
                  <label htmlFor={"workspace-settings-region"}>Region</label>
                  <input value={newHoliday.region} onChange={e=>setNewHoliday(h=>({...h,region:e.target.value}))}
                    placeholder="ALL" style={{maxWidth:80}} id={"workspace-settings-region"} />
                </div>
                <button className="btn-secondary" style={{alignSelf:"flex-end",marginBottom:"4px"}}
                  onClick={async()=>{
                    if (!newHoliday.name||!newHoliday.date) return;
                    await client.post(`/workspaces/${activeWorkspace.id}/holidays`, newHoliday);
                    setNewHoliday({name:"",date:"",recurring:true,region:"ALL"});
                    setSuccess("Holiday added");
                  }}>+ Add</button>
              </div>
            </div>
          )}

          {/* ── User Groups tab ── */}
          {activeNav === "groups" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">👤 User Groups</h3>
              <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"14px"}}>
                Groups let you assign permissions and manage access for multiple users at once.
              </p>
              {groups.map(g=>(
                <div key={g.id} style={{display:"flex",gap:"10px",alignItems:"flex-start",
                  background:"var(--bg-card)",border:"1px solid var(--border)",
                  borderRadius:"var(--radius-md)",padding:"12px",marginBottom:"8px"}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:g.color,marginTop:4,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:"13px"}}>{g.name}</div>
                    {g.description&&<div style={{fontSize:"11px",color:"var(--gray-400)"}}>{g.description}</div>}
                    <div style={{fontSize:"11px",color:"var(--gray-400)",marginTop:"3px"}}>
                      {(g.memberEmails||[]).length} members · {(g.permissions||[]).length} permissions
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"4px",marginTop:"6px"}}>
                      {(g.permissions||[]).map(p=>(
                        <span key={p} style={{fontSize:"9px",fontWeight:700,padding:"1px 7px",
                          borderRadius:"99px",background:"rgba(99,102,241,.1)",color:"#6366f1"}}>{p}</span>
                      ))}
                    </div>
                  </div>
                  <button className="btn-icon" onClick={async()=>{
                    await client.delete(`/workspace/groups/${g.id}`);
                    setGroups(prev=>prev.filter(x=>x.id!==g.id));
                  }}>🗑️</button>
                </div>
              ))}
              <div style={{background:"var(--gray-50)",border:"1px solid var(--border)",borderRadius:"var(--radius-md)",padding:"14px",marginTop:"12px"}}>
                <div style={{fontWeight:700,fontSize:"13px",marginBottom:"10px"}}>Create Group</div>
                <div className="form-row">
                  <div className="form-group" style={{flex:2}}>
                    <label htmlFor={"workspace-settings-name-2"}>Name</label>
                    <input value={groupForm.name} onChange={e=>setGroupForm(f=>({...f,name:e.target.value}))}
                      placeholder="e.g. Engineering Leads" id={"workspace-settings-name-2"} />
                  </div>
                  <div className="form-group">
                    <label htmlFor={"workspace-settings-color"}>Color</label>
                    <input type="color" value={groupForm.color}
                      onChange={e=>setGroupForm(f=>({...f,color:e.target.value}))}
                      style={{height:"36px",padding:"2px",width:"60px"}} id={"workspace-settings-color"} />
                  </div>
                </div>
                <div className="form-group">
                  <span className="field-label">Permissions</span>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
                    {["VIEW_ALL","CREATE_TASK","EDIT_ALL","DELETE_TASK","CREATE_PROJECT","MANAGE_TEAM","MANAGE_GOALS","CREATE_DOC","VIEW_ANALYTICS","MANAGE_AUTOMATION"].map(p=>(
                      <label key={p} style={{display:"flex",alignItems:"center",gap:"4px",cursor:"pointer",
                        padding:"3px 10px",borderRadius:"99px",fontSize:"11px",fontWeight:600,
                        border:"1px solid var(--border)",
                        background:groupForm.permissions.includes(p)?"rgba(99,102,241,.1)":"var(--bg-card)",
                        color:groupForm.permissions.includes(p)?"#6366f1":"var(--gray-600)"}}>
                        <input type="checkbox" style={{display:"none"}} checked={groupForm.permissions.includes(p)}
                          onChange={()=>setGroupForm(f=>({...f,permissions:f.permissions.includes(p)
                            ?f.permissions.filter(x=>x!==p):[...f.permissions,p]}))} />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
                <button className="btn-primary" disabled={!groupForm.name} onClick={async()=>{
                  const r = await client.post("/workspace/groups", groupForm);
                  setGroups(prev=>[...prev, r.data]);
                  setGroupForm({name:"",description:"",color:"#6366f1",memberEmails:[],permissions:[]});
                  setSuccess("Group created");
                }}>+ Create Group</button>
              </div>

              <div style={{fontWeight:700,fontSize:"13px",marginTop:"24px",marginBottom:"8px"}}>📧 Bulk Invite</div>
              <p style={{fontSize:"12px",color:"var(--gray-400)",marginBottom:"8px"}}>Paste one email per line to invite multiple members.</p>
              <textarea rows={4} value={bulkEmails} onChange={e=>setBulkEmails(e.target.value)}
                placeholder={"alice@company.com\nbob@company.com\ncarol@company.com"} />
              <div className="form-row" style={{marginTop:"8px",gap:"8px",alignItems:"center"}}>
                <select value={bulkRole} onChange={e=>setBulkRole(e.target.value)} style={{maxWidth:140}}>
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button className="btn-primary" disabled={!bulkEmails.trim()} onClick={async()=>{
                  const emails = bulkEmails.split("\n").map(e=>e.trim()).filter(Boolean);
                  await Promise.all(emails.map(email=>client.post("/invitations",{email,role:bulkRole})));
                  setBulkEmails(""); setSuccess(`${emails.length} invitation(s) sent`);
                }}>Send {bulkEmails.trim().split("\n").filter(Boolean).length || 0} Invites</button>
              </div>

              <div style={{fontWeight:700,fontSize:"13px",marginTop:"20px",marginBottom:"6px"}}>👤 Guest / External Access</div>
              <p style={{fontSize:"12px",color:"var(--gray-400)",marginBottom:"8px"}}>Guests get read-only access via a secure link — no password needed.</p>
              <div className="form-row">
                <div className="form-group" style={{flex:2}}>
                  <input value={guestEmail} onChange={e=>setGuestEmail(e.target.value)}
                    placeholder="external@client.com" />
                </div>
                <button className="btn-secondary" disabled={!guestEmail} onClick={async()=>{
                  const r = await client.post("/workspace/guest-invite",{email:guestEmail});
                  setSuccess(`Guest link generated — token: ${r.data.token}`);
                  setGuestEmail("");
                }}>🔗 Generate Guest Link</button>
              </div>
            </div>
          )}

          {/* ── Permissions tab ── */}
          {activeNav === "permissions" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">🔐 Permission Matrix</h3>
              {permMatrix ? (
                <div>
                  {Object.entries(permMatrix.roles||{}).map(([role,perms])=>(
                    <div key={role} style={{display:"flex",gap:"12px",alignItems:"flex-start",
                      padding:"10px 12px",background:"var(--bg-card)",border:"1px solid var(--border)",
                      borderRadius:"var(--radius-sm)",marginBottom:"6px"}}>
                      <div style={{minWidth:80,fontWeight:800,fontSize:"12px",color:"#6366f1"}}>{role}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                        {(Array.isArray(perms)?perms:["ALL"]).map(p=>(
                          <span key={p} style={{fontSize:"9px",fontWeight:700,padding:"2px 7px",
                            borderRadius:"99px",background:"rgba(99,102,241,.1)",color:"#6366f1"}}>{p}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div style={{fontWeight:700,fontSize:"13px",marginTop:"16px",marginBottom:"10px"}}>Inheritance Rules</div>
                  {[["OWNER","→","All permissions including delete workspace"],
                    ["ADMIN","→","Inherits all MEMBER permissions + team management"],
                    ["MEMBER","→","Inherits all VIEWER permissions + create/edit"],
                    ["VIEWER","→","Read-only + comment"],
                    ["GUEST","→","View assigned content only"]].map(([r,a,d])=>(
                    <div key={r} style={{display:"flex",gap:"10px",padding:"7px 10px",
                      borderBottom:"1px solid var(--border)",fontSize:"12px"}}>
                      <span style={{fontWeight:700,minWidth:70,color:"#6366f1"}}>{r}</span>
                      <span style={{color:"var(--gray-400)"}}>{a}</span>
                      <span style={{color:"var(--gray-600)"}}>{d}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <button className="btn-secondary" onClick={async()=>{
                  const r = await client.get("/workspace/permissions/matrix");
                  setPermMatrix(r.data);
                }}>Load Permission Matrix</button>
              )}
            </div>
          )}

          {/* ── Org Hierarchy tab ── */}
          {activeNav === "hierarchy" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">🏗 Organisation Hierarchy</h3>
              <button className="btn-secondary" style={{marginBottom:"14px"}} onClick={async()=>{
                const r = await client.get("/workspace/hierarchy");
                setHierarchy(r.data);
              }}>🔄 Load Hierarchy</button>
              {hierarchy && (
                <div>
                  {(hierarchy.hierarchy||[]).length===0 && (
                    <div className="empty-state">No parent-child relationships configured yet.</div>
                  )}
                  {(hierarchy.hierarchy||[]).map(org=>(
                    <div key={org.id} style={{marginBottom:"12px"}}>
                      <div style={{display:"flex",gap:"8px",alignItems:"center",
                        padding:"10px 12px",background:"var(--bg-card)",border:"2px solid #6366f1",
                        borderRadius:"var(--radius-md)"}}>
                        <span>🏢</span>
                        <span style={{fontWeight:800}}>{org.name}</span>
                        <span style={{fontSize:"10px",background:"rgba(99,102,241,.1)",color:"#6366f1",
                          padding:"2px 8px",borderRadius:"99px"}}>{org.tenantType}</span>
                      </div>
                      {(org.children||[]).map(child=>(
                        <div key={child.id} style={{display:"flex",gap:"8px",alignItems:"center",
                          padding:"8px 12px 8px 32px",marginTop:"4px",
                          background:"var(--gray-50)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)"}}>
                          <span style={{color:"var(--gray-400)"}}>└</span>
                          <span>📁</span>
                          <span style={{fontWeight:600,fontSize:"13px"}}>{child.name}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div style={{fontSize:"12px",color:"var(--gray-400)"}}>
                    Total: {hierarchy.totalWorkspaces} workspace(s)
                  </div>
                  <div style={{marginTop:"16px",fontWeight:700,fontSize:"13px"}}>Tenant Type</div>
                  <div className="form-group" style={{maxWidth:280,marginTop:"8px"}}>
                    <select onChange={async e=>{
                      await client.patch(`/workspace/${activeWorkspace.id}/parent`,{tenantType:e.target.value});
                      setSuccess("Tenant type updated");
                    }}>
                      <option value="SHARED">Shared (multi-tenant)</option>
                      <option value="DEDICATED">Dedicated (isolated resources)</option>
                      <option value="SINGLE_TENANT">Single-tenant (private cloud)</option>
                    </select>
                    <div className="admin-field-help">Dedicated/single-tenant requires Enterprise plan.</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Workspace Templates tab ── */}
          {activeNav === "templates" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">📋 Workspace Templates</h3>
              <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"14px"}}>
                Templates are reusable workspace configurations. Clone one to create a pre-configured workspace.
              </p>
              <div style={{display:"flex",flexWrap:"wrap",gap:"10px",marginBottom:"16px"}}>
                {wsTemplates.map(t=>(
                  <div key={t.id} style={{background:"var(--bg-card)",border:"1px solid var(--border)",
                    borderRadius:"var(--radius-lg)",padding:"14px",minWidth:180}}>
                    <div style={{fontWeight:800,fontSize:"13px",marginBottom:"3px"}}>{t.name}</div>
                    <div style={{fontSize:"10px",color:"var(--gray-400)",marginBottom:"10px"}}>
                      {t.templateCategory||"Custom"}
                    </div>
                    <button className="btn-primary" style={{fontSize:"11px",width:"100%"}}
                      onClick={async()=>{
                        const name = prompt("Name for the new workspace:", t.name+" Copy");
                        if (!name) return;
                        const r = await client.post(`/workspace/${t.id}/clone`,
                          {name,includeProjects:"true"});
                        setSuccess(`Workspace cloned: ${r.data.name}`);
                      }}>🔀 Clone</button>
                  </div>
                ))}
                {wsTemplates.length===0 && (
                  <div className="empty-state">No templates yet.</div>
                )}
              </div>
              <div style={{display:"flex",gap:"8px"}}>
                <button className="btn-secondary" onClick={async()=>{
                  await client.patch(`/workspaces/${activeWorkspace.id}`,{isTemplate:true});
                  setSuccess("Workspace marked as template");
                }}>📋 Save as Template</button>
                <button className="btn-primary" onClick={async()=>{
                  const name = prompt("Name for the cloned workspace:", activeWorkspace.name+" (Copy)");
                  if (!name) return;
                  const r = await client.post(`/workspace/${activeWorkspace.id}/clone`,{name});
                  setSuccess(`Cloned: ${r.data.name}`);
                }}>🔀 Clone This Workspace</button>
              </div>
            </div>
          )}

          {/* ── Cross-workspace Access tab ── */}
          {activeNav === "crossaccess" && (
            <div className="ws-settings-section">
              <h3 className="ws-settings-section-title">🔗 Cross-Workspace Access</h3>
              <p style={{fontSize:"13px",color:"var(--gray-500)",marginBottom:"14px"}}>
                Allow users from other workspaces in your organisation to access resources here.
              </p>
              <div className="form-row">
                <div className="form-group" style={{flex:2}}>
                  <label htmlFor="cross-ws-id">Other Workspace ID</label>
                  <input id="cross-ws-id" placeholder="workspace-id-from-org" />
                </div>
                <button className="btn-primary" style={{alignSelf:"flex-end",marginBottom:"4px"}}
                  onClick={async()=>{
                    const el = document.getElementById("cross-ws-id");
                    if (!el?.value) return;
                    await client.post(`/workspace/${activeWorkspace.id}/cross-access`,
                      {workspaceId:el.value});
                    el.value=""; setSuccess("Cross-workspace access granted");
                  }}>Grant Access</button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Admin Delete Confirmation Modal */}
      {showAdminDeleteModal && selectedMember && (
        <div className="modal-overlay" onClick={() => setShowAdminDeleteModal(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setShowAdminDeleteModal(false))?.(e); } }}>
          <div className="modal" style={{ maxWidth: "440px" }} onClick={(e) => e.stopPropagation()} role="presentation">
            <h2 style={{ color: "var(--danger)", marginBottom: "8px" }}>🗑️ Delete Account</h2>
            <p style={{ fontSize: "14px", color: "var(--gray-600)", marginBottom: "16px" }}>
              Permanently deleting the account of:
            </p>
            <div className="admin-delete-member-row" style={{ background: "var(--gray-50)", borderRadius: "var(--radius-md)", padding: "12px 16px", marginBottom: "20px" }}>
              <div className="admin-delete-avatar" style={{ background: selectedMember.color || "#6366f1" }}>
                {selectedMember.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="admin-delete-info">
                <div className="admin-delete-name">{selectedMember.name}</div>
                <div className="admin-delete-email">{selectedMember.email}</div>
              </div>
            </div>
            {adminDeleteSuccess && <div className="settings-success-banner">✅ {adminDeleteSuccess}</div>}
            {adminDeleteError   && <div className="settings-error-banner">⚠️ {adminDeleteError}</div>}
            {!adminDeleteSuccess && (
              <>
                <div className="form-group">
                  <label>Type <strong>{selectedMember.email}</strong> to confirm:</label>
                  <input value={adminDeleteConfirm}
                    onChange={(e) => { setAdminDeleteConfirm(e.target.value); setAdminDeleteError(""); }}
                    placeholder={selectedMember.email}
                    style={{ borderColor: adminDeleteConfirm === selectedMember.email ? "#10b981" : undefined }} />
                </div>
                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => setShowAdminDeleteModal(false)}>Cancel</button>
                  <button className="btn-danger"
                    disabled={adminDeleteLoading || adminDeleteConfirm !== selectedMember.email}
                    onClick={handleAdminDelete}>
                    {adminDeleteLoading ? "⏳ Deleting..." : "🗑️ Permanently Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
