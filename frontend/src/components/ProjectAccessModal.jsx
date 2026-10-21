import { useEffect, useState } from "react";
import { getAccessOptions, updateProjectAccess } from "../api/access";
import { getTeamMembers } from "../api/team";
import { apiErrorMessage } from "../utils/apiError";
import { useAccess } from "../hooks/useAccess";

const VISIBILITY_OPTIONS = [
  { value: "WORKSPACE", label: "Whole workspace", hint: "Everyone whose access reaches workspace-wide projects." },
  { value: "DEPARTMENTS", label: "Selected departments", hint: "People in the chosen departments, plus anyone named below." },
  { value: "MEMBERS_ONLY", label: "Named people only", hint: "Only the people named below (and the project's creator)." },
];

const unwrap = (res) => (Array.isArray(res?.data) ? res.data : res?.data?.content || res?.data?.items || []);

/**
 * Who can see a project and who is responsible for it. The server decides who may change this and
 * refuses everything else; this dialog only collects the choices.
 */
export default function ProjectAccessModal({ project, onClose, onSaved }) {
  const { restricted } = useAccess();
  const [departments, setDepartments] = useState([]);
  const [members, setMembers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({
    visibility: project.visibility || "WORKSPACE",
    departmentIds: project.departmentIds || [],
    memberEmails: project.memberEmails || [],
    roleAssignments: project.roleAssignments || {},
    approverEmails: project.approverEmails || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAccessOptions()
      .then((r) => { if (!cancelled) { setDepartments(r.data?.departments || []); setSlots(r.data?.roleSlots || []); } })
      .catch(() => {});
    getTeamMembers().then((r) => { if (!cancelled) setMembers(unwrap(r)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await updateProjectAccess(project.id, form);
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save access settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-access-title" style={{ maxWidth: 560 }}>
        <h2 id="project-access-title">Access — {project.name}</h2>

        <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
          <legend>Who can see this project</legend>
          {VISIBILITY_OPTIONS.map((o) => (
            <label key={o.value} style={{ display: "block", marginBottom: 6 }}>
              <input
                type="radio" name="project-visibility" value={o.value}
                checked={form.visibility === o.value}
                disabled={restricted && o.value === "WORKSPACE"}
                onChange={() => set("visibility", o.value)}
              />{" "}
              <strong>{o.label}</strong> <span style={{ opacity: 0.7 }}>— {o.hint}</span>
            </label>
          ))}
        </fieldset>

        {form.visibility === "DEPARTMENTS" && (
          <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
            <legend>Departments</legend>
            {departments.length === 0 && <p style={{ opacity: 0.7 }}>No departments are set up yet (an admin creates them under Access Control).</p>}
            {departments.map((d) => (
              <label key={d.id} style={{ display: "inline-block", marginRight: 12 }}>
                <input type="checkbox" checked={form.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} /> {d.name}
              </label>
            ))}
          </fieldset>
        )}

        {slots.length > 0 && (
          <div className="form-group">
            <span>Responsibilities</span>
            {slots.map((s) => (
              <div key={s.key} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <label htmlFor={`slot-${s.key}`} style={{ minWidth: 170 }}>{s.label}</label>
                <select
                  id={`slot-${s.key}`}
                  value={form.roleAssignments[s.key] || ""}
                  onChange={(e) => set("roleAssignments", { ...form.roleAssignments, [s.key]: e.target.value })}
                >
                  <option value="">— not assigned —</option>
                  {members.map((m) => <option key={m.id} value={m.email}>{m.name} ({m.email})</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
          <legend>Other people on this project</legend>
          {members.map((m) => (
            <label key={m.id} style={{ display: "inline-block", marginRight: 12 }}>
              <input type="checkbox" checked={form.memberEmails.includes(m.email)} onChange={() => toggle("memberEmails", m.email)} /> {m.name}
            </label>
          ))}
        </fieldset>

        <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
          <legend>Approvers</legend>
          {members.map((m) => (
            <label key={m.id} style={{ display: "inline-block", marginRight: 12 }}>
              <input type="checkbox" checked={form.approverEmails.includes(m.email)} onChange={() => toggle("approverEmails", m.email)} /> {m.name}
            </label>
          ))}
        </fieldset>

        {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save access"}</button>
        </div>
      </div>
    </div>
  );
}
