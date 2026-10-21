import { useEffect, useState } from "react";
import { getAccessOptions } from "../api/access";
import { updateDocAccess } from "../api/docs";
import { getTeamMembers } from "../api/team";
import { apiErrorMessage } from "../utils/apiError";
import { useAccess } from "../hooks/useAccess";

const unwrap = (res) => (Array.isArray(res?.data) ? res.data : res?.data?.content || res?.data?.items || []);

const AUDIENCES = [
  { value: "PRIVATE", label: "Only me and people I share it with", needs: "sharing" },
  { value: "DEPARTMENTS", label: "Selected departments", needs: "departments" },
  { value: "WORKSPACE", label: "Everyone in the workspace", needs: "workspace" },
];

/**
 * Who can see a document. Which choices are offered follows the workspace's document-sharing setting
 * (by department, by person, or both) and the person's own access; the server enforces all of it.
 */
export default function DocAccessModal({ doc, onClose, onSaved }) {
  const { restricted } = useAccess();
  const [mode, setMode] = useState("BOTH");
  const [departments, setDepartments] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({
    audience: doc.audience || "PRIVATE",
    departmentIds: doc.departmentIds || [],
    sharedWith: doc.sharedWith || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAccessOptions()
      .then((r) => { if (!cancelled) { setDepartments(r.data?.departments || []); setMode(r.data?.docAccessMode || "BOTH"); } })
      .catch(() => {});
    getTeamMembers().then((r) => { if (!cancelled) setMembers(unwrap(r)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const departmentsOn = mode !== "PRIVATE_SHARED";
  const sharingOn = mode !== "DEPARTMENTS";
  const offered = AUDIENCES.filter((a) => {
    if (a.value === "WORKSPACE") return !restricted;
    if (a.value === "DEPARTMENTS") return departmentsOn;
    return true;
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await updateDocAccess(doc.id, form);
      onSaved?.(res.data?.data || res.data);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save who can see this document."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="doc-access-title" style={{ maxWidth: 520 }}>
        <h2 id="doc-access-title">Who can see “{doc.title || "Untitled"}”</h2>

        <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
          <legend>Audience</legend>
          {offered.map((a) => (
            <label key={a.value} style={{ display: "block", marginBottom: 6 }}>
              <input type="radio" name="doc-audience" value={a.value} checked={form.audience === a.value} onChange={() => set("audience", a.value)} /> {a.label}
            </label>
          ))}
          {!doc.audience && <p style={{ opacity: 0.7 }}>This document was made before departments were set up, so for now only its creator and people it's shared with can see it.</p>}
        </fieldset>

        {form.audience === "DEPARTMENTS" && departmentsOn && (
          <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
            <legend>Departments</legend>
            {departments.length === 0 && <p style={{ opacity: 0.7 }}>No departments are set up yet.</p>}
            {departments.map((d) => (
              <label key={d.id} style={{ display: "inline-block", marginRight: 12 }}>
                <input type="checkbox" checked={form.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} /> {d.name}
              </label>
            ))}
          </fieldset>
        )}

        {sharingOn && form.audience !== "WORKSPACE" && (
          <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
            <legend>Also shared with</legend>
            {members.map((m) => (
              <label key={m.id} style={{ display: "inline-block", marginRight: 12 }}>
                <input type="checkbox" checked={form.sharedWith.includes(m.email)} onChange={() => toggle("sharedWith", m.email)} /> {m.name}
              </label>
            ))}
          </fieldset>
        )}

        {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
