import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWorkspace, deleteWorkspace, getMyWorkspaces,
} from "../api/workspaces";
import { useAuth } from "../hooks/useAuth";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";
import {
  INDUSTRIES, ROLES, recommendTemplate, suggestedDescription, industryByKey, roleByKey,
} from "../config/workspaceRecommendation";

import "../styles/pages/workspace.css";
const TIMEZONES = [
  "UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "Europe/London","Europe/Paris","Europe/Berlin","Asia/Kolkata","Asia/Tokyo",
  "Asia/Singapore","Australia/Sydney",
];
const AVATARS = ["🚀","💼","🏢","⚡","🎯","🔮","🌟","🦁"];

export default function WorkspaceSetup() {
  const { activeWorkspace, setActiveWorkspace } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { show: showToast } = useToast();
  const fileInputRef = useRef(null);

  const [mode,           setMode]           = useState("create");
  const [initialLoading, setInitialLoading] = useState(true);
  const [step,           setStep]           = useState(1);  // 1=template 2=details 3=done
  const [loading,        setLoading]        = useState(false);
  const [deleteLoading,  setDeleteLoading]  = useState(null);
  const [error,          setError]          = useState("");
  const [logoMode,       setLogoMode]       = useState("file");
  const [logoPreview,    setLogoPreview]    = useState(null);
  const [logoBase64,     setLogoBase64]     = useState(null);
  const [workspaces,     setWorkspaces]     = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  // Step 1 answers — the template is derived from these, never picked by hand.
  const [industry, setIndustry] = useState("");
  const [userRole, setUserRole] = useState("");
  const recommendation = industry && userRole ? recommendTemplate(industry, userRole) : null;

  const EMPTY = { name:"", timezone:"Asia/Kolkata", avatar:"🚀",
    logoUrl:"", dateFormat:"DD/MM/YYYY", description:"", template:"" };
  const [form, setForm] = useState(EMPTY);
  const set = (k,v) => setForm(p => ({...p,[k]:v}));

  useEffect(() => {
    getMyWorkspaces()
      .then(r => {
        const ws = r.data || [];
        setWorkspaces(ws);
        setMode(ws.length > 0 ? "manage" : "create");
        if (activeWorkspace && ws.length > 0) {
          const cur = ws.find(w => w.id === activeWorkspace.id);
          if (cur) {
            setForm({
              name: cur.name||"", timezone: cur.timezone||"Asia/Kolkata",
              avatar: cur.avatar||"🚀", logoUrl: cur.logoUrl||"",
              dateFormat: cur.dateFormat||"DD/MM/YYYY",
              description: cur.description||"", template:"",
            });
            setLogoPreview(cur.logoUrl||null);
          }
        }
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [activeWorkspace]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setLogoPreview(ev.target.result);
      setLogoBase64(ev.target.result);
      set("logoUrl", ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const resetAnswers = () => { setIndustry(""); setUserRole(""); setSelectedTemplate(null); };

  // Applies the template recommended for the person's field + role and moves on to details.
  const continueWithAnswers = () => {
    if (!recommendation) return;
    const tpl = recommendation.template;
    setSelectedTemplate(tpl);
    set("template", tpl.id);
    if (tpl.settings?.dateFormat) set("dateFormat", tpl.settings.dateFormat);
    // Pre-fill a description only if the person hasn't typed one (or it is still our earlier suggestion).
    setForm(p => {
      const previousSuggestions = INDUSTRIES.map(i => suggestedDescription(i.key)).filter(Boolean);
      const untouched = !p.description || previousSuggestions.includes(p.description);
      return untouched ? { ...p, description: suggestedDescription(industry) } : p;
    });
    setStep(2);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { setError("Workspace name is required"); return; }
    setLoading(true); setError("");
    try {
      const payload = {
        name: form.name.trim(),
        timezone: form.timezone,
        avatar: form.avatar,
        logoUrl: logoBase64 || form.logoUrl || null,
        dateFormat: form.dateFormat,
        description: form.description,
        templateId: selectedTemplate?.id || "blank",
        industry: industry || null,
        userRole: userRole || null,
      };
      const r = await createWorkspace(payload);
      // Was unwrapList(r) — POST /workspaces returns the created Workspace
      // object directly, not a list, so this was silently setting the
      // active workspace to [] right after creating it.
      setActiveWorkspace(r.data);
      setStep(3);
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete this workspace?", message: "All data will be permanently lost.", danger: true, confirmText: "Delete" });
    if (!ok) return;
    setDeleteLoading(id);
    try {
      await deleteWorkspace(id);
      const updated = workspaces.filter(w => w.id !== id);
      setWorkspaces(updated);
      if (activeWorkspace?.id === id) {
        if (updated.length > 0) { setActiveWorkspace(updated[0]); navigate("/"); }
        else { setActiveWorkspace(null); setMode("create"); setStep(1); }
      }
    } catch (e) {
      showToast("Delete failed: " + (e?.response?.data?.message || e.message), "error");
    } finally {
      setDeleteLoading(null);
    }
  };

  if (initialLoading) return (
    <div className="ws-shell">
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh"}}>
        <div className="spinner"/>
      </div>
    </div>
  );

  return (
    <div className="ws-shell">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="ws-header">
        <div className="ws-logo">
          <img src="/logo-wordmark.png" alt="Prowosma" />
        </div>
        {workspaces.length > 0 && (
          <div style={{display:"flex",gap:8}}>
            <button className="ws-btn-secondary"
              onClick={()=>{ setMode("manage"); setStep(1); }}>
              Manage workspaces
            </button>
            <button className="ws-btn-secondary" onClick={()=>navigate("/")}>
              ← Back to app
            </button>
          </div>
        )}
      </div>

      {/* ── Mode: Manage ──────────────────────────────────────── */}
      {mode === "manage" && (
        <div className="ws-center">
          <div className="ws-card" style={{maxWidth:600}}>
            <h2 className="ws-title">Your workspaces</h2>
            <p className="ws-sub">Switch, edit, or create new workspaces below.</p>

            <div style={{display:"flex",flexDirection:"column",gap:10,margin:"20px 0"}}>
              {workspaces.map(ws => (
                <div key={ws.id} className={"ws-item"+(activeWorkspace?.id===ws.id?" ws-item-active":"")}>
                  <div className="ws-item-icon">{ws.avatar||"🏢"}</div>
                  <div className="ws-item-info">
                    <div className="ws-item-name">{ws.name}</div>
                    <div className="ws-item-meta">{ws.timezone||"UTC"}</div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    {activeWorkspace?.id !== ws.id && (
                      <button className="ws-btn-xs" onClick={()=>{ setActiveWorkspace(ws); navigate("/"); }}>
                        Switch
                      </button>
                    )}
                    <button className="ws-btn-xs ws-btn-danger"
                      disabled={deleteLoading===ws.id}
                      onClick={()=>handleDelete(ws.id)}>
                      {deleteLoading===ws.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button className="ws-btn-primary" style={{width:"100%"}}
              onClick={()=>{ setMode("create"); setStep(1); setForm(EMPTY); resetAnswers(); }}>
              + Create new workspace
            </button>
          </div>
        </div>
      )}

      {/* ── Mode: Create — Step 1: About you (field + role) ─── */}
      {/* People found "choose a template" confusing, so we ask two plain questions and pick the
          template for them (see config/workspaceRecommendation.js). */}
      {mode === "create" && step === 1 && (
        <div className="ws-center ws-center-wide">
          <div className="ws-templates-page">
            <div style={{textAlign:"center",marginBottom:28}}>
              <h1 className="ws-title" style={{fontSize:28}}>Tell us a little about your work</h1>
              <p className="ws-sub">Answer two quick questions and we&apos;ll set up the workspace for you.</p>
            </div>

            <section className="ws-question" aria-labelledby="ws-q-industry">
              <h2 className="ws-question-title" id="ws-q-industry">
                <span className="ws-question-num">1</span> Which field do you work in?
              </h2>
              <div className="ws-choice-grid" role="radiogroup" aria-labelledby="ws-q-industry">
                {INDUSTRIES.map(opt => (
                  <button key={opt.key} type="button" role="radio" aria-checked={industry===opt.key}
                    className={"ws-choice-card"+(industry===opt.key?" active":"")}
                    onClick={()=>setIndustry(opt.key)}>
                    <span className="ws-choice-icon" aria-hidden="true">{opt.icon}</span>
                    <span className="ws-choice-text">
                      <span className="ws-choice-label">{opt.label}</span>
                      <span className="ws-choice-hint">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="ws-question" aria-labelledby="ws-q-role">
              <h2 className="ws-question-title" id="ws-q-role">
                <span className="ws-question-num">2</span> What best describes your role?
              </h2>
              <div className="ws-choice-grid" role="radiogroup" aria-labelledby="ws-q-role">
                {ROLES.map(opt => (
                  <button key={opt.key} type="button" role="radio" aria-checked={userRole===opt.key}
                    className={"ws-choice-card"+(userRole===opt.key?" active":"")}
                    onClick={()=>setUserRole(opt.key)}>
                    <span className="ws-choice-icon" aria-hidden="true">{opt.icon}</span>
                    <span className="ws-choice-text">
                      <span className="ws-choice-label">{opt.label}</span>
                      <span className="ws-choice-hint">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="ws-recommend" aria-live="polite">
              {recommendation ? (
                <div className="ws-recommend-box" data-testid="ws-recommendation">
                  <span className="ws-tpl-icon" aria-hidden="true"
                    style={{background:`${recommendation.template.color}18`,color:recommendation.template.color}}>
                    {recommendation.template.icon}
                  </span>
                  <span className="ws-recommend-text">
                    <strong>We&apos;ll set you up with: {recommendation.template.name}</strong>
                    <span>{recommendation.reason}</span>
                  </span>
                </div>
              ) : (
                <p className="ws-sub" style={{textAlign:"center"}}>
                  {industry ? "Now pick your role." : "Pick your field to get started."}
                </p>
              )}
              <button className="ws-btn-primary ws-recommend-btn" type="button"
                disabled={!recommendation} onClick={continueWithAnswers}>
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mode: Create — Step 2: Details ─────────────────── */}
      {mode === "create" && step === 2 && (
        <div className="ws-center">
          <div className="ws-card" style={{maxWidth:520}}>
            {selectedTemplate && (
              <div className="ws-tpl-pill">
                <span>{selectedTemplate.icon}</span>
                <span>
                  Set up for {industryByKey(industry)?.label || "your field"}
                  {roleByKey(userRole) ? ` · ${roleByKey(userRole).label}` : ""}
                </span>
                <button onClick={()=>setStep(1)} style={{background:"none",border:"none",
                  cursor:"pointer",color:"inherit",fontSize:11,marginLeft:"auto"}}>
                  Change answers
                </button>
              </div>
            )}

            <h2 className="ws-title" style={{marginTop:16}}>Set up your workspace</h2>
            <p className="ws-sub">You can change all of these settings later.</p>

            {error && <div className="ws-error">{error}</div>}

            {/* Avatar row */}
            <div className="ws-field">
              <span className="ws-label" id="workspace-setup-icon-label">Workspace icon</span>
              <div className="ws-avatars" role="radiogroup" aria-labelledby="workspace-setup-icon-label">
                {AVATARS.map(a=>(
                  <button key={a} className={"ws-avatar-btn"+(form.avatar===a?" active":"")}
                    role="radio" aria-checked={form.avatar===a}
                    onClick={()=>set("avatar",a)}>{a}</button>
                ))}
              </div>
            </div>

            <div className="ws-field">
              <label className="ws-label" htmlFor={"workspace-setup-workspace-name"}>Workspace name <span style={{color:"#D64545"}}>*</span></label>
              <input className="ws-input" value={form.name}
                onChange={e=>set("name",e.target.value)}
                placeholder="e.g. Acme Engineering"
                onKeyDown={e=>e.key==="Enter"&&handleCreate()} id={"workspace-setup-workspace-name"}/>
            </div>

            <div className="ws-field">
              <label className="ws-label" htmlFor={"workspace-setup-description"}>Description</label>
              <input className="ws-input" value={form.description}
                onChange={e=>set("description",e.target.value)}
                placeholder="What does this workspace manage?" id={"workspace-setup-description"}/>
            </div>

            <div className="ws-field">
              <label className="ws-label" htmlFor={"workspace-setup-timezone"}>Timezone</label>
              <select className="ws-input" value={form.timezone}
                onChange={e=>set("timezone",e.target.value)} id={"workspace-setup-timezone"}>
                {TIMEZONES.map(tz=><option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>

            <div className="ws-field">
              <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
                <legend className="ws-label" style={{ padding: 0 }}>Logo</legend>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  {["file","url"].map(m=>(
                    <button key={m} className={"ws-btn-xs"+(logoMode===m?" active":"")}
                      onClick={()=>setLogoMode(m)}>
                      {m==="file"?"Upload file":"URL"}
                    </button>
                  ))}
                </div>
                {logoMode==="file" ? (
                  <>
                    <button className="ws-btn-secondary" style={{fontSize:12}}
                      onClick={()=>fileInputRef.current?.click()}>
                      Choose image
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*"
                      style={{display:"none"}} onChange={handleFileChange}/>
                  </>
                ) : (
                  <input className="ws-input" value={form.logoUrl}
                    onChange={e=>{set("logoUrl",e.target.value);setLogoPreview(e.target.value);}}
                    placeholder="https://yourcompany.com/logo.png"/>
                )}
                {logoPreview && (
                  <div style={{marginTop:8,display:"flex",alignItems:"center",gap:10}}>
                    <img src={logoPreview} alt="logo preview"
                      style={{height:40,maxWidth:120,objectFit:"contain",
                        borderRadius:6,border:"1px solid var(--border)"}}/>
                    <button className="ws-btn-xs ws-btn-danger"
                      onClick={()=>{setLogoPreview(null);setLogoBase64(null);set("logoUrl","");}}>
                      Remove
                    </button>
                  </div>
                )}
              </fieldset>
            </div>

            <div style={{
              fontSize: 11.5, lineHeight: 1.5, color:"#64748b",
              background: "var(--gray-50, var(--gray-50))", border: "1px solid var(--border)",
              borderRadius: 8, padding: "8px 10px", marginTop: 10,
            }}>
              Creating this workspace makes you its <strong>Manager</strong> — full admin
              rights, and only you can delete it or transfer it. You can invite
              teammates as Admins, Members, or Viewers afterward.
            </div>

            <div style={{display:"flex",gap:10,marginTop:8}}>
              <button className="ws-btn-secondary" onClick={()=>setStep(1)}>← Back</button>
              <button className="ws-btn-primary" style={{flex:1}}
                onClick={handleCreate} disabled={loading||!form.name.trim()}>
                {loading ? "Creating…" : "Create workspace →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ────────────────────────────────────── */}
      {mode === "create" && step === 3 && (
        <div className="ws-center">
          <div className="ws-card" style={{maxWidth:480,textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:16}}>🎉</div>
            <h2 className="ws-title">Workspace ready!</h2>
            <p className="ws-sub" style={{margin:"8px 0 24px"}}>
              Your workspace has been created
              {selectedTemplate && ` and set up for ${industryByKey(industry)?.label || "your team"}`}.
            </p>
            <button className="ws-btn-primary" style={{width:"100%",fontSize:15}}
              onClick={()=>navigate("/")}>
              Open workspace →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
