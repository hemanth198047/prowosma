import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { apiErrorMessage } from "../utils/apiError";
import { EXAMPLE_ORG_SETUP } from "../config/orgTemplates";
import {
  getAccessSettings, updateAccessSettings,
  getAccessProfiles, createAccessProfile, updateAccessProfile, deleteAccessProfile,
  getDepartments, createDepartment, updateDepartment, setDepartmentMembers, deleteDepartment,
  getAccessMembers, updateAccessMember, runOrgSetup, assignLegacyDocs,
} from "../api/access";

const unwrap = (res) => (Array.isArray(res?.data) ? res.data : res?.data?.content || []);

const SCOPE_LABELS = {
  ALL: "Everything in the workspace",
  MY_DEPARTMENTS: "Their departments' projects, plus projects they are named on",
  ASSIGNED_ONLY: "Only work assigned to them",
};
const VISIBILITY_LABELS = {
  WORKSPACE: "Whole workspace",
  DEPARTMENTS: "Selected departments",
  MEMBERS_ONLY: "Named people only",
};
const DOC_MODE_LABELS = {
  BOTH: "Both — each document chooses: departments, or only the people it is shared with",
  DEPARTMENTS: "By department only",
  PRIVATE_SHARED: "Only the creator and the people a document is shared with",
};
const CAPABILITY_LABELS = {
  CREATE_PROJECT: "Create projects",
  CREATE_TASK: "Create tasks",
  ALLOCATE_TASKS: "Assign tasks to others",
  APPROVE: "Approve work",
  VIEW_FINANCIALS: "See budgets and revenue",
  USE_MEETING_ASSISTANT: "Use the meeting assistant, including Fireflies (their own meetings only)",
};

/* ── Overview: switch, defaults, project roles ─────────────────────────── */
function LegacyDocsCard({ departments, notify }) {
  const [audience, setAudience] = useState("DEPARTMENTS");
  const [ids, setIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      const res = await assignLegacyDocs(audience, audience === "DEPARTMENTS" ? ids : []);
      notify(`${res.data?.updated ?? 0} document(s) updated`, "success");
    } catch (e) { notify(apiErrorMessage(e, "Could not update the documents"), "error"); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="Documents made before access control" className="card" style={{ marginTop: 20, padding: 12 }}>
      <h2 style={{ marginTop: 0, fontSize: "1.1em" }}>Documents made before access control</h2>
      <p style={{ opacity: 0.75 }}>
        Until a document has an audience, only its creator (and people it's shared with) can see it once people are restricted.
        Give all such documents an audience in one step; anything that already has one is left alone.
      </p>
      <div className="form-group">
        <label htmlFor="ac-legacy-aud">Make them visible to</label>
        <select id="ac-legacy-aud" value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="DEPARTMENTS">Selected departments</option>
          <option value="WORKSPACE">Everyone in the workspace</option>
          <option value="PRIVATE">Only their creators</option>
        </select>
      </div>
      {audience === "DEPARTMENTS" && (
        <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
          <legend>Departments</legend>
          {departments.map((d) => (
            <label key={d.id} style={{ display: "inline-block", marginRight: 12 }}>
              <input type="checkbox" checked={ids.includes(d.id)} onChange={() => setIds((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : [...x, d.id]))} /> {d.name}
            </label>
          ))}
          {departments.length === 0 && <span style={{ opacity: 0.7 }}>Create departments first.</span>}
        </fieldset>
      )}
      <button className="btn-secondary" onClick={apply} disabled={busy || (audience === "DEPARTMENTS" && ids.length === 0)}>{busy ? "Updating…" : "Apply to older documents"}</button>
    </section>
  );
}

function OverviewTab({ settings, profiles, departments, reload, notify }) {
  const [docMode, setDocMode] = useState(settings.docAccessMode || "BOTH");
  const [enabled, setEnabled] = useState(!!settings.accessControlEnabled);
  const [defaultProfile, setDefaultProfile] = useState(settings.defaultAccessProfileId || "");
  const [visibility, setVisibility] = useState(settings.defaultProjectVisibility || "WORKSPACE");
  const [slots, setSlots] = useState(settings.projectRoleSlots || []);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState([]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateAccessSettings({
        accessControlEnabled: enabled,
        defaultAccessProfileId: defaultProfile || null,
        defaultProjectVisibility: visibility,
        docAccessMode: docMode,
        projectRoleSlots: slots.filter((s) => s.label.trim()).map((s) => ({ key: s.key || "", label: s.label.trim() })),
      });
      setWarnings(res.data?.warnings || []);
      notify("Access settings saved", "success");
      reload();
    } catch (e) {
      notify(apiErrorMessage(e, "Could not save settings"), "error");
    } finally { setSaving(false); }
  };

  return (
    <section aria-label="Access settings">
      <div className="form-group">
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
          <strong>Separate departments</strong> — people only see what their access profile allows
        </label>
        <p style={{ opacity: 0.75, margin: "4px 0 0" }}>
          Off by default. Until it is on, and people have an access profile, everyone sees everything as before.
          The workspace owner is never restricted.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="ac-default-profile">Profile for members who don't have one</label>
        <select id="ac-default-profile" value={defaultProfile} onChange={(e) => setDefaultProfile(e.target.value)}>
          <option value="">None — they see everything (current behaviour)</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p style={{ opacity: 0.75, margin: "4px 0 0" }}>Choose a restrictive profile so anyone who joins later starts with limited access.</p>
      </div>

      <div className="form-group">
        <label htmlFor="ac-default-vis">New projects are visible to</label>
        <select id="ac-default-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          {Object.entries(VISIBILITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="ac-doc-mode">How documents are shared</label>
        <select id="ac-doc-mode" value={docMode} onChange={(e) => setDocMode(e.target.value)}>
          {Object.entries(DOC_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p style={{ opacity: 0.75, margin: "4px 0 0" }}>Decides what people can choose when they share a document, and what is honoured. A workspace owner or unrestricted admin sees every document either way.</p>
      </div>

      <div className="form-group">
        <span id="ac-slots-label">Project responsibilities</span>
        <p style={{ opacity: 0.75, margin: "4px 0" }}>The named roles every project can assign to a person (for example Creative Lead). Define what fits your business.</p>
        {slots.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input
              aria-label={`Project role ${i + 1}`} value={s.label} placeholder="e.g. Creative Lead"
              onChange={(e) => setSlots((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <button className="btn-icon" aria-label={`Remove project role ${i + 1}`} onClick={() => setSlots((all) => all.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn-secondary" onClick={() => setSlots((all) => [...all, { key: "", label: "" }])}>+ Add a responsibility</button>
      </div>

      {warnings.map((w) => <p key={w} role="status" style={{ color: "var(--warning)" }}>⚠️ {w}</p>)}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
      <LegacyDocsCard departments={departments} notify={notify} />
    </section>
  );
}

/* ── Profiles ──────────────────────────────────────────────────────────── */
function ProfileForm({ initial, capabilities, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: "", description: "", scope: "MY_DEPARTMENTS", departmentAdmin: false, capabilities: [] });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleCap = (c) => set("capabilities", form.capabilities.includes(c) ? form.capabilities.filter((x) => x !== c) : [...form.capabilities, c]);
  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ac-profile-title">
        <h2 id="ac-profile-title">{initial ? "Edit access profile" : "New access profile"}</h2>
        <div className="form-group">
          <label htmlFor="ac-profile-name">Name *</label>
          <input id="ac-profile-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Department Member" />
        </div>
        <div className="form-group">
          <label htmlFor="ac-profile-desc">Description</label>
          <input id="ac-profile-desc" value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="ac-profile-scope">What they can see</label>
          <select id="ac-profile-scope" value={form.scope} onChange={(e) => set("scope", e.target.value)}>
            {Object.entries(SCOPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {form.scope === "MY_DEPARTMENTS" && (
          <div className="form-group">
            <label>
              <input type="checkbox" checked={form.departmentAdmin} onChange={(e) => set("departmentAdmin", e.target.checked)} />{" "}
              Department admin — can manage access to their departments' projects
            </label>
          </div>
        )}
        {form.scope !== "ALL" && (
          <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
            <legend>What they can do</legend>
            {capabilities.map((c) => (
              <label key={c} style={{ display: "block" }}>
                <input type="checkbox" checked={form.capabilities.includes(c)} onChange={() => toggleCap(c)} /> {CAPABILITY_LABELS[c] || c}
              </label>
            ))}
          </fieldset>
        )}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!form.name.trim()} onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ProfilesTab({ profiles, settings, reload, notify }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null = closed, {} = new, profile = edit

  const save = async (form) => {
    try {
      if (editing?.id) await updateAccessProfile(editing.id, form); else await createAccessProfile(form);
      setEditing(null);
      notify("Profile saved", "success");
      reload();
    } catch (e) { notify(apiErrorMessage(e, "Could not save the profile"), "error"); }
  };
  const remove = async (p) => {
    const ok = await confirm({ title: `Delete "${p.name}"?`, message: "Only possible when nobody uses it.", danger: true, confirmText: "Delete" });
    if (!ok) return;
    try { await deleteAccessProfile(p.id); notify("Profile deleted", "success"); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not delete the profile"), "error"); }
  };

  return (
    <section aria-label="Access profiles">
      <p style={{ opacity: 0.75 }}>An access profile says what a person can see and do. A person's workspace role (Admin / Member / Viewer) is separate and still controls workspace settings.</p>
      <button className="btn-primary" onClick={() => setEditing({})}>+ New profile</button>
      <table className="data-table" style={{ width: "100%", marginTop: 12 }}>
        <thead><tr><th>Name</th><th>Can see</th><th>Can do</th><th /></tr></thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.id === settings.defaultAccessProfileId && <span className="badge"> default</span>}
                {p.description && <div style={{ opacity: 0.7 }}>{p.description}</div>}</td>
              <td>{SCOPE_LABELS[p.scope] || p.scope}{p.departmentAdmin ? " · department admin" : ""}</td>
              <td>{p.scope === "ALL" ? "Everything" : (p.capabilities || []).map((c) => CAPABILITY_LABELS[c] || c).join(", ") || "Update their own tasks, comment"}</td>
              <td>
                <button className="btn-icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>✏️</button>
                <button className="btn-icon" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>🗑</button>
              </td>
            </tr>
          ))}
          {profiles.length === 0 && <tr><td colSpan={4} className="empty-state">No profiles yet.</td></tr>}
        </tbody>
      </table>
      {editing && <ProfileForm initial={editing.id ? editing : null} capabilities={settings.capabilities || []} onSave={save} onCancel={() => setEditing(null)} />}
    </section>
  );
}

/* ── Departments ───────────────────────────────────────────────────────── */
function DepartmentsTab({ departments, members, reload, notify }) {
  const confirm = useConfirm();
  const [name, setName] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    try { await createDepartment({ name: name.trim() }); setName(""); notify("Department created", "success"); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not create the department"), "error"); }
  };
  const toggleMember = async (d, email) => {
    const has = (d.memberEmails || []).some((x) => x.toLowerCase() === email.toLowerCase());
    const next = has ? d.memberEmails.filter((x) => x.toLowerCase() !== email.toLowerCase()) : [...(d.memberEmails || []), email];
    try { await setDepartmentMembers(d.id, next); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not update the department"), "error"); }
  };
  const rename = async (d) => {
    const next = window.prompt("Department name", d.name);
    if (!next || next.trim() === d.name) return;
    try { await updateDepartment(d.id, { name: next.trim() }); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not rename the department"), "error"); }
  };
  const remove = async (d) => {
    const ok = await confirm({ title: `Delete "${d.name}"?`, message: "Only possible when no project belongs to it.", danger: true, confirmText: "Delete" });
    if (!ok) return;
    try { await deleteDepartment(d.id); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not delete the department"), "error"); }
  };

  return (
    <section aria-label="Departments">
      <p style={{ opacity: 0.75 }}>Departments decide which projects a person sees. Being in a department is separate from their job title and from owning a project.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input aria-label="New department name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-production" />
        <button className="btn-primary" onClick={add}>+ Add department</button>
      </div>
      {departments.map((d) => (
        <div key={d.id} className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{d.name}</strong>
            <span>
              <button className="btn-icon" aria-label={`Rename ${d.name}`} onClick={() => rename(d)}>✏️</button>
              <button className="btn-icon" aria-label={`Delete ${d.name}`} onClick={() => remove(d)}>🗑</button>
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            {members.map((m) => (
              <label key={m.id} style={{ display: "inline-block", marginRight: 12 }}>
                <input
                  type="checkbox" aria-label={`${m.name} in ${d.name}`}
                  checked={(d.memberEmails || []).some((x) => x.toLowerCase() === (m.email || "").toLowerCase())}
                  onChange={() => toggleMember(d, m.email)}
                /> {m.name}
              </label>
            ))}
            {members.length === 0 && <span style={{ opacity: 0.7 }}>No members in this workspace yet.</span>}
          </div>
        </div>
      ))}
      {departments.length === 0 && <p className="empty-state">No departments yet.</p>}
    </section>
  );
}

/* ── People ────────────────────────────────────────────────────────────── */
function PeopleTab({ members, profiles, departments, reload, notify }) {
  const save = async (m, patch) => {
    try { await updateAccessMember(m.id, patch); reload(); }
    catch (e) { notify(apiErrorMessage(e, "Could not update this person"), "error"); }
  };
  return (
    <section aria-label="People">
      <p style={{ opacity: 0.75 }}>Give each person a designation, an access profile and their departments. A person with no profile gets the workspace default (see Overview).</p>
      <table className="data-table" style={{ width: "100%" }}>
        <thead><tr><th>Person</th><th>Designation</th><th>Access profile</th><th>Departments</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td><strong>{m.name}</strong><div style={{ opacity: 0.7 }}>{m.email} · {m.role}</div></td>
              <td>
                <input
                  aria-label={`Designation for ${m.name}`} defaultValue={m.designation || ""} placeholder="e.g. Video Editor"
                  onBlur={(e) => { if (e.target.value !== (m.designation || "")) save(m, { designation: e.target.value }); }}
                />
              </td>
              <td>
                <select aria-label={`Access profile for ${m.name}`} value={m.accessProfileId || ""} onChange={(e) => save(m, { accessProfileId: e.target.value || null })}>
                  <option value="">Workspace default</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>
                {departments.map((d) => (
                  <label key={d.id} style={{ display: "inline-block", marginRight: 10 }}>
                    <input
                      type="checkbox" aria-label={`${m.name} in ${d.name}`} checked={(m.departmentIds || []).includes(d.id)}
                      onChange={() => save(m, { departmentIds: (m.departmentIds || []).includes(d.id) ? m.departmentIds.filter((x) => x !== d.id) : [...(m.departmentIds || []), d.id] })}
                    /> {d.name}
                  </label>
                ))}
              </td>
            </tr>
          ))}
          {members.length === 0 && <tr><td colSpan={4} className="empty-state">No members yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

/* ── Organisation setup (apply a whole structure) ──────────────────────── */
function OrgSetupTab({ reload, notify }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);

  const parse = () => {
    try { return JSON.parse(text); } catch { setError("That isn't valid JSON. Check for a missing comma or quote."); return null; }
  };
  const run = async (dryRun) => {
    setError(""); setResult(null);
    const plan = parse();
    if (!plan) return;
    setBusy(true);
    try {
      const res = await runOrgSetup(plan, { dryRun, sendInvitations: invite });
      setResult(res.data);
      if (!dryRun) { notify("Organisation setup applied", "success"); reload(); }
    } catch (e) { setError(apiErrorMessage(e, "Could not run the setup")); }
    finally { setBusy(false); }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  };

  return (
    <section aria-label="Organisation setup">
      <p style={{ opacity: 0.75 }}>
        Describe your departments, access profiles, project responsibilities and people as JSON, preview what would change, then apply it.
        It can be run again safely: things are matched by name or email and updated, not duplicated. People who aren't in the workspace yet are only invited if you tick the box.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button className="btn-secondary" onClick={() => setText(JSON.stringify(EXAMPLE_ORG_SETUP, null, 2))}>Load an example</button>
        <label className="btn-secondary" style={{ cursor: "pointer" }}>
          Open a .json file <input type="file" accept="application/json,.json" onChange={onFile} style={{ display: "none" }} />
        </label>
      </div>
      <label htmlFor="ac-setup-json" style={{ display: "block" }}>Structure (JSON)</label>
      <textarea id="ac-setup-json" rows={16} style={{ width: "100%", fontFamily: "monospace" }} value={text} onChange={(e) => setText(e.target.value)} />
      <label style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Send invitations to people who aren't in the workspace yet
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-secondary" disabled={busy || !text.trim()} onClick={() => run(true)}>Preview changes</button>
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => run(false)}>Apply</button>
      </div>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {result && (
        <div role="status" style={{ marginTop: 12 }}>
          <strong>{result.dryRun ? "Preview — nothing has been changed" : "Applied"}</strong>
          <ul>{(result.actions || []).map((a) => <li key={a}>{a}</li>)}</ul>
          {(result.warnings || []).length > 0 && (
            <>
              <strong>Needs your attention</strong>
              <ul>{result.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "profiles", label: "Access profiles" },
  { id: "departments", label: "Departments" },
  { id: "people", label: "People" },
  { id: "setup", label: "Organisation setup" },
];

export default function AccessControl() {
  const { show } = useToast();
  const notify = useCallback((m, t) => show(m, t), [show]);
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, p, d, m] = await Promise.all([getAccessSettings(), getAccessProfiles(), getDepartments(), getAccessMembers()]);
      setData({ settings: s.data, profiles: unwrap(p), departments: unwrap(d), members: unwrap(m) });
      setLoadError("");
    } catch (e) { setLoadError(apiErrorMessage(e, "Could not load access settings")); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; load() also serves as the reload callback for the tabs
  useEffect(() => { load(); }, [load]);

  // Re-key the overview form when the saved settings change so it shows what was stored.
  const overviewKey = useMemo(() => JSON.stringify(data?.settings || {}), [data]);

  return (
    <div className="page">
      <PageHeader
        icon="🔐" title="Access Control"
        description="Decide who sees which projects and tasks: departments, access profiles and project responsibilities."
      />
      {loadError && <p role="alert" style={{ color: "var(--danger)" }}>{loadError}</p>}
      {!data && !loadError && <div className="empty-state">Loading…</div>}
      {data && (
        <>
          <div role="tablist" aria-label="Access control sections" style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button
                key={t.id} role="tab" aria-selected={tab === t.id} id={`ac-tab-${t.id}`} aria-controls={`ac-panel-${t.id}`}
                className={tab === t.id ? "btn-primary" : "btn-secondary"} onClick={() => setTab(t.id)}
              >{t.label}</button>
            ))}
          </div>
          <div role="tabpanel" id={`ac-panel-${tab}`} aria-labelledby={`ac-tab-${tab}`}>
            {tab === "overview" && <OverviewTab key={overviewKey} settings={data.settings} profiles={data.profiles} departments={data.departments} reload={load} notify={notify} />}
            {tab === "profiles" && <ProfilesTab profiles={data.profiles} settings={data.settings} reload={load} notify={notify} />}
            {tab === "departments" && <DepartmentsTab departments={data.departments} members={data.members} reload={load} notify={notify} />}
            {tab === "people" && <PeopleTab members={data.members} profiles={data.profiles} departments={data.departments} reload={load} notify={notify} />}
            {tab === "setup" && <OrgSetupTab reload={load} notify={notify} />}
          </div>
        </>
      )}
    </div>
  );
}
