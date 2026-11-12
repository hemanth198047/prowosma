import { apiErrorMessage } from "../utils/apiError";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, UserPlus, Trash2, AlertTriangle, Search } from "lucide-react";
import PersonAvatar from "./people/PersonAvatar";
import { usePeople } from "../context/PeopleContext";
import { useToast } from "./ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { updateProjectTeam } from "../api/org";
import { fetchProjects } from "../api/projects";
import { PROJECT_ROLES, allocationByEmail } from "../utils/org";

function rowsFrom(project) {
  const details = new Map((project.teamDetails || []).map((t) => [String(t.email).toLowerCase(), t]));
  return (project.memberEmails || []).map((email) => {
    const d = details.get(email.toLowerCase());
    return { email, projectRole: d?.projectRole || "", allocationPercent: d?.allocationPercent ?? "" };
  });
}

/**
 * Who works on a project, their role on it and how much of their time it takes.
 * Saving replaces the project's member list, so it is the same list the Access dialog shows.
 */
export default function ProjectTeamModal({ project, onClose, onSaved }) {
  const { people, byEmail, ensureLoaded } = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState(() => rowsFrom(project));
  const [initial] = useState(() => JSON.stringify(rowsFrom(project)));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [otherLoad, setOtherLoad] = useState(new Map());

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  // Allocation on OTHER projects, to warn about over-allocation.
  useEffect(() => {
    fetchProjects().then((list) => setOtherLoad(allocationByEmail(list.filter((p) => p.id !== project.id)))).catch(() => {});
  }, [project.id]);

  const inTeam = useMemo(() => new Set(rows.map((r) => r.email.toLowerCase())), [rows]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.email && !inTeam.has(p.email.toLowerCase()))
      .filter((p) => !q || [p.name, p.email, p.title, p.department].some((v) => v && v.toLowerCase().includes(q)))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .slice(0, 8);
  }, [people, inTeam, query]);

  const setRow = (email, k, v) => setRows((rs) => rs.map((r) => (r.email === email ? { ...r, [k]: v } : r)));
  const add = (p) => { setRows((rs) => [...rs, { email: p.email, projectRole: "", allocationPercent: "" }]); setQuery(""); };
  const remove = (email) => setRows((rs) => rs.filter((r) => r.email !== email));

  const dirty = JSON.stringify(rows) !== initial;
  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({ title: "Discard team changes?", message: "Your changes to the project team haven't been saved.", confirmText: "Discard", danger: true }))) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const totalFor = (r) => (otherLoad.get(r.email.toLowerCase()) || 0) + (Number(r.allocationPercent) || 0);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const res = await updateProjectTeam(project.id, rows.map((r) => ({
        email: r.email,
        projectRole: r.projectRole.trim() || null,
        allocationPercent: r.allocationPercent === "" ? null : Number(r.allocationPercent),
      })));
      toast.show("Project team saved", "success");
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      const status = e?.response?.status;
      setError(status === 403
        ? "Only the project's creator, a department admin of its departments, or a workspace admin can change the team."
        : apiErrorMessage(e, "Couldn't save the team. Please try again."));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="ptm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }} role="presentation">
      <div className="ptm" role="dialog" aria-modal="true" aria-labelledby="ptm-title">
        <div className="ptm-head">
          <div>
            <h2 id="ptm-title">Project team</h2>
            <div className="ptm-sub">{project.name} · {rows.length} {rows.length === 1 ? "person" : "people"}</div>
          </div>
          <button type="button" className="pc-icon-btn" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="ptm-add">
          <div className="ptm-search">
            <Search size={15} aria-hidden="true" />
            <input
              placeholder="Add people by name, email, title or department"
              aria-label="Add people to the project team"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && candidates[0]) { e.preventDefault(); add(candidates[0]); } }}
            />
          </div>
          {query.trim() && (
            <div className="ptm-results" role="listbox" aria-label="Matching people">
              {candidates.length === 0 && <div className="ptm-none">No one else matches.</div>}
              {candidates.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected="false" className="ptm-result" onClick={() => add(p)}>
                  <PersonAvatar person={p} size={28} showName interactive={false} subtitle={p.title || p.email} />
                  <UserPlus size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        <datalist id="ptm-roles">{PROJECT_ROLES.map((r) => <option key={r} value={r} />)}</datalist>

        <div className="ptm-list">
          {rows.length === 0 && <div className="ptm-empty">No one is on this project yet. Search above to add people.</div>}
          {rows.length > 0 && (
            <div className="ptm-row ptm-row-head" aria-hidden="true">
              <span>Person</span><span>Role on this project</span><span>Allocation</span><span />
            </div>
          )}
          {rows.map((r) => {
            const p = byEmail.get(r.email.toLowerCase());
            const total = totalFor(r);
            return (
              <div key={r.email} className="ptm-row">
                <div className="ptm-person">
                  <PersonAvatar person={p || { email: r.email }} email={r.email} size={32} showName subtitle={p?.title || r.email} />
                </div>
                <input
                  list="ptm-roles"
                  aria-label={`Role of ${p?.name || r.email} on this project`}
                  placeholder="e.g. Developer"
                  maxLength={60}
                  value={r.projectRole}
                  onChange={(e) => setRow(r.email, "projectRole", e.target.value)}
                />
                <div className="ptm-alloc">
                  <input
                    type="number" min={0} max={100} step={5}
                    aria-label={`Share of ${p?.name || r.email}'s time on this project, in percent`}
                    placeholder="—"
                    value={r.allocationPercent}
                    onChange={(e) => setRow(r.email, "allocationPercent", e.target.value === "" ? "" : Math.max(0, Math.min(100, Number(e.target.value))))}
                  />
                  <span>%</span>
                  {total > 100 && (
                    <span className="ptm-over" title={`${total}% across all projects`}>
                      <AlertTriangle size={13} aria-hidden="true" /> {total}% total
                    </span>
                  )}
                </div>
                <button type="button" className="pc-icon-btn ptm-remove" onClick={() => remove(r.email)} aria-label={`Remove ${p?.name || r.email} from the team`}>
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>

        {error && <div className="pc-error ptm-error" role="alert">{error}</div>}

        <div className="ptm-foot">
          <span className="ptm-hint">Team members can always see this project.</span>
          <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save team"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
