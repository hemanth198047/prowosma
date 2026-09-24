import React from "react";
import { unwrapList } from "../api/client";
import client from "../api/client";
import { useState, useEffect } from "react";
import {
  getTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
} from "../api/team";
import { getTasks, updateTask } from "../api/tasks";
import { getProjects } from "../api/projects";
import {
  sendInvitation,
  getPendingInvites,
  cancelInvitation,
  resendInvitation,
} from "../api/invitations";
import PageHeader from "../components/PageHeader";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../components/ToastContext";

// ── Expertise API ─────────────────────────────────────────────
const expertiseApi = {
  infer:          ()           => client.post("/expertise/infer"),
  findExperts:    (skill, n)   => client.get(`/expertise/find?skill=${encodeURIComponent(skill)}&limit=${n||8}`),
  skillMap:       ()           => client.get("/expertise/skills"),
  gaps:           ()           => client.get("/expertise/gaps"),
  mentors:        (skill)      => client.get(`/expertise/mentors${skill?`?skill=${encodeURIComponent(skill)}`:""}`),
  tribalKnowledge:()           => client.get("/expertise/tribal-knowledge"),
  aiRecommend:    (query)      => client.post("/expertise/ai-recommend", {query}),
  graph:          ()           => client.get("/expertise/graph"),
  updateProfile:  (id, data)   => client.patch(`/expertise/members/${id}/profile`, data),
};
import CanDo from "../components/CanDo";
import { useAuth } from "../hooks/useAuth";
import { useRole } from "../hooks/useRole";
import { apiErrorMessage } from "../utils/apiError";

const ROLES = ["MEMBER", "VIEWER", "ADMIN"];
const COLORS = [
  "var(--brand-500)",
  "var(--warning)",
  "var(--success)",
  "var(--danger)",
  "#3b82f6",
  "var(--purple)",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];
const roleColor = { OWNER: "var(--warning)", ADMIN: "var(--danger)", MEMBER: "var(--brand-500)", VIEWER: "var(--success)" };
// Display-only relabel: the underlying role value is still "OWNER"
// everywhere it matters (DB, RoleGuardFilter, isOwner checks) — this just
// changes what the word looks like on screen, per feedback that "Owner"
// read as too informal/consumer-y for a workspace-management role.
const roleLabel = (role) => (role === "OWNER" ? "MANAGER" : role);
const statusColor = {
  TODO: "var(--brand-500)",
  IN_PROGRESS: "var(--warning)",
  DONE: "var(--success)",
};
const priorityColor = { LOW: "var(--success)", MEDIUM: "var(--warning)", HIGH: "var(--danger)" };

function MemberAvatar({ member, size = 36 }) {
  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: member.color || "var(--brand-500)",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.35,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function MemberForm({ initial, onSave, onCancel, saving, isOwner }) {
  const [form, setForm] = useState(
    initial || { name: "", email: "", role: "MEMBER", color:"#5B5FEE" },
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Only the workspace Manager can grant/keep the Admin role — see
  // TeamMemberService.assertCanAssignRole on the backend, which enforces
  // this regardless of what the UI allows. If a non-Manager is editing
  // someone who is *already* Admin, that option stays visible (so the
  // dropdown shows their real current role) but disabled, since a non-
  // Manager submitting this form can't change it anyway.
  //
  // Note: "Manager" is purely a display label — the underlying role value
  // stored everywhere (DB, JWT/session role, RoleGuardFilter) is still
  // "OWNER". Only user-facing copy changed here, not the data model.
  const canPickAdmin = isOwner || form.role === "ADMIN";

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (saving ? undefined : onCancel)?.(e); } }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <h2>{initial ? "Edit Member" : "Add Team Member"}</h2>
        <div className="form-group">
          <label htmlFor={"team-name"}>Name *</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Full name"
            disabled={saving} id={"team-name"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"team-email"}>Email *</label>
          <input
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="email@example.com"
            type="email"
            disabled={saving} id={"team-email"}
          />
        </div>
        <div className="form-group">
          <label htmlFor={"team-role"}>Role</label>
          <select
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            disabled={saving} id={"team-role"}
          >
            {ROLES.map((r) => (
              <option key={r} value={r} disabled={r === "ADMIN" && !canPickAdmin}>
                {r === "ADMIN" && !canPickAdmin ? "ADMIN (Manager only)" : r}
              </option>
            ))}
          </select>
          {!isOwner && (
            <span style={{ fontSize: "11px", color:"#64748b", marginTop: "4px", display: "block" }}>
              Only the workspace Manager can grant the Admin role.
            </span>
          )}
        </div>
        <div className="form-group">
          <span id="team-avatar-color-label">Avatar Color</span>
          <div className="color-picker" role="radiogroup" aria-labelledby="team-avatar-color-label">
            {COLORS.map((c) => (
              <div
                key={c}
                className={`color-dot ${form.color === c ? "selected" : ""}`}
                style={{ background: c, opacity: saving ? 0.5 : 1, pointerEvents: saving ? "none" : "auto" }}
                onClick={() => set("color", c)} role="radio" aria-checked={form.color===c} tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => set("color", c))?.(e); } }}
              />
            ))}
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !form.name.trim() || !form.email.trim()}
            onClick={() =>
              form.name.trim() && form.email.trim() && onSave(form)
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ task, members, onSave, onCancel }) {
  const [selected, setSelected] = useState(task.assigneeIds || []);

  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  return (
    <div className="modal-overlay" onClick={onCancel} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onCancel)?.(e); } }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <h2>Assign Task</h2>
        <p style={{ color: "#888", marginBottom: "16px", fontSize: "13px" }}>
          {task.title}
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "20px",
          }}
        >
          {members.map((m) => (
            <div
              key={m.id}
              className={`assign-member-row ${selected.includes(m.id) ? "selected" : ""}`}
              onClick={() => toggle(m.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => toggle(m.id))?.(e); } }}
            >
              <MemberAvatar member={m} size={32} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>
                  {m.name}
                </div>
                <div style={{ fontSize: "11px", color: "#888" }}>{m.email}</div>
              </div>
              <div
                className={`assign-check ${selected.includes(m.id) ? "checked" : ""}`}
              >
                {selected.includes(m.id) && "✓"}
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <p className="empty-state" style={{ fontSize: "13px" }}>
              No team members yet.
            </p>
          )}
        </div>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(selected)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Team() {
  const { activeWorkspace } = useAuth();
  const { isOwner } = useRole();
  const confirm = useConfirm();
  const { show: toast } = useToast();
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assignTask, setAssignTask] = useState(null);
  const [activeTab, setActiveTab] = useState("members");
  const [memberSort, setMemberSort] = useState("");

  // F03 — Invitation state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "MEMBER" });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const load = async () => {
    const [memberRes, taskRes, projRes] = await Promise.all([
      getTeamMembers(),
      getTasks(),
      getProjects(),
    ]);
    setMembers(unwrapList(memberRes));
    setTasks(unwrapList(taskRes));
    setProjects(unwrapList(projRes));
  };

  useEffect(() => {
    const fetchData = async () => {
      const [memberRes, taskRes, projRes] = await Promise.all([
        getTeamMembers(),
        getTasks(),
        getProjects(),
      ]);
      setMembers(unwrapList(memberRes));
      setTasks(unwrapList(taskRes));
      setProjects(unwrapList(projRes));
    };
    fetchData();
  }, [activeWorkspace?.id]);

  // F03 — Load pending invites
  useEffect(() => {
    const fetchInvites = async () => {
      try {
        const res = await getPendingInvites();
        setPendingInvites(unwrapList(res));
      } catch (e) {
        console.error("Failed to load invitations:", e);
      }
    };
    fetchInvites();
  }, []);

  const [savingMember, setSavingMember] = useState(false);

  const handleSave = async (form) => {
    setSavingMember(true);
    try {
      if (editing) await updateTeamMember(editing.id, form);
      else await createTeamMember(form);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      toast(apiErrorMessage(e, "Couldn't save this member."), "error");
    } finally {
      setSavingMember(false);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Remove this member?", message: "They will lose access to the workspace.", danger: true, confirmText: "Remove" });
    if (ok) {
      await deleteTeamMember(id);
      load();
    }
  };

  const handleAssign = async (assigneeIds) => {
    await updateTask(assignTask.id, { ...assignTask, assigneeIds });
    setAssignTask(null);
    load();
  };

  // F03 — Invite handlers
  const handleSendInvite = async () => {
    if (!inviteForm.email.trim()) {
      setInviteError("Email is required");
      return;
    }
    setInviteLoading(true);
    setInviteError("");
    setInviteSuccess("");
    try {
      await sendInvitation(inviteForm);
      setInviteSuccess("Invitation sent to " + inviteForm.email);
      setInviteForm({ email: "", role: "MEMBER" });
      const res = await getPendingInvites();
      setPendingInvites(unwrapList(res));
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteSuccess("");
      }, 2000);
    } catch (e) {
      setInviteError(apiErrorMessage(e, "Failed to send invitation"));
    } finally {
      setInviteLoading(false);
    }
  };

  const [inviteRowBusy, setInviteRowBusy] = useState({}); // { [inviteId]: "cancel" | "resend" }

  const handleCancelInvite = async (invite) => {
    setInviteRowBusy((m) => ({ ...m, [invite.id]: "cancel" }));
    try {
      await cancelInvitation(invite.id);
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      toast(`Invitation to ${invite.email} cancelled`, "success");
    } catch {
      toast(`Couldn't cancel the invitation to ${invite.email}`, "error");
      setInviteRowBusy((m) => { const n = { ...m }; delete n[invite.id]; return n; });
    }
  };

  const handleResendInvite = async (invite) => {
    setInviteRowBusy((m) => ({ ...m, [invite.id]: "resend" }));
    try {
      await resendInvitation(invite.id);
      toast(`Invitation resent to ${invite.email}`, "success");
    } catch (e) {
      toast(apiErrorMessage(e, `Couldn't resend the invitation to ${invite.email}`), "error");
    } finally {
      setInviteRowBusy((m) => { const n = { ...m }; delete n[invite.id]; return n; });
    }
  };

  const getProjectName = (id) => projects.find((p) => p.id === id)?.name || "";

  const getTasksForMember = (memberId) =>
    tasks.filter((t) => t.assigneeIds?.includes(memberId));

  const unassignedTasks = tasks.filter(
    (t) => !t.assigneeIds || t.assigneeIds.length === 0,
  );

  return (
    <div>
      <PageHeader
        icon="👥"
        title="Team"
        description="Manage team members and assign tasks"
        action={
          <div style={{ display: "flex", gap: "10px" }}>
            <CanDo action="manageMembers">
              <button
                className="btn-secondary"
                onClick={() => setShowInviteModal(true)}
              >
                ✉️ Invite Member
              </button>
            </CanDo>
            <CanDo action="manageMembers">
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                + Add Member
              </button>
            </CanDo>
          </div>
        }
      />

      <div
        className="tab-bar"
        style={{
          marginBottom: "20px",
          background: "#fff",
          borderRadius: "10px",
          border: "1px solid #eee",
        }}
      >
        <button
          className={`tab-btn ${activeTab === "members" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("members")}
        >
          👥 Members ({members.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "assignments" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("assignments")}
        >
          📋 Assignments
        </button>
        <button
          className={`tab-btn ${activeTab === "unassigned" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("unassigned")}
        >
          ⚠️ Unassigned ({unassignedTasks.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "invitations" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("invitations")}
        >
          ✉️ Invitations{" "}
          {pendingInvites.length > 0 && `(${pendingInvites.length})`}
        </button>
        <button
          className={`tab-btn ${activeTab === "expertise" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("expertise")}
        >
          🧠 Expertise
        </button>
      </div>

      {/* Members Tab */}
      {activeTab === "members" && (
        <>
        {members.length > 1 && (
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:"10px" }}>
            <select value={memberSort} onChange={e=>setMemberSort(e.target.value)} style={{ fontSize:"12px" }}>
              <option value="">Sort by: Default</option>
              <option value="name">Sort by: Name</option>
              <option value="role">Sort by: Role</option>
              <option value="load">Sort by: Task Load</option>
            </select>
          </div>
        )}
        <div className="cards-grid">
          {[...members].sort((a, b) => {
            if (memberSort === "name") return (a.name||"").localeCompare(b.name||"");
            // Manager (Owner) > Admin > Member > Viewer — the natural
            // reading order of a permissions hierarchy, not alphabetical
            // (which would put Admin before Manager before Member).
            if (memberSort === "role") {
              const order = { OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3 };
              return (order[a.role] ?? 9) - (order[b.role] ?? 9);
            }
            if (memberSort === "load") return getTasksForMember(b.id).length - getTasksForMember(a.id).length;
            return 0;
          }).map((m) => {
            const memberTasks = getTasksForMember(m.id);
            const doneTasks = memberTasks.filter(
              (t) => t.status === "DONE",
            ).length;
            const inProgressTasks = memberTasks.filter(
              (t) => t.status === "IN_PROGRESS",
            ).length;
            return (
              <div key={m.id} className="team-member-card">
                <div className="team-member-header">
                  <MemberAvatar member={m} size={48} />
                  <div className="team-member-info">
                    <div className="team-member-name">{m.name}</div>
                    <div className="team-member-email">{m.email}</div>
                    <span
                      className="badge"
                      style={{
                        background: roleColor[m.role] + "22",
                        color: roleColor[m.role],
                        fontSize: "10px",
                      }}
                    >
                      {roleLabel(m.role)}
                    </span>
                  </div>
                  <div className="card-actions">
                    {m.role !== "OWNER" && (
                      <>
                        <CanDo action="manageMembers">
                          <button
                            className="btn-icon"
                            onClick={() => {
                              setEditing(m);
                              setShowForm(true);
                            }}
                          >
                            ✏️
                          </button>
                        </CanDo>
                        <CanDo action="manageMembers">
                          <button
                            className="btn-icon"
                            onClick={() => handleDelete(m.id)}
                          >
                            🗑️
                          </button>
                        </CanDo>
                      </>
                    )}
                  </div>
                </div>
                <div className="team-member-stats">
                  <div className="team-stat">
                    <span className="team-stat-value">
                      {memberTasks.length}
                    </span>
                    <span className="team-stat-label">Tasks</span>
                  </div>
                  <div className="team-stat">
                    <span
                      className="team-stat-value"
                      style={{ color:"#C17D22" }}
                    >
                      {inProgressTasks}
                    </span>
                    <span className="team-stat-label">In Progress</span>
                  </div>
                  <div className="team-stat">
                    <span
                      className="team-stat-value"
                      style={{ color:"#1E8E5A" }}
                    >
                      {doneTasks}
                    </span>
                    <span className="team-stat-label">Done</span>
                  </div>
                </div>
                {memberTasks.length > 0 && (
                  <div className="progress-bar" style={{ marginTop: "8px" }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.round((doneTasks / memberTasks.length) * 100)}%`,
                        background: m.color || "var(--brand-500)",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="empty-state">No team members yet.</p>
          )}
        </div>
        </>
      )}

      {/* Assignments Tab */}
      {activeTab === "assignments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {members.map((m) => {
            const memberTasks = getTasksForMember(m.id);
            return (
              <div key={m.id} className="assignment-section">
                <div className="assignment-header">
                  <MemberAvatar member={m} size={32} />
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>
                    {m.name}
                  </span>
                  <span
                    className="task-status-badge"
                    style={{ background: "#f0f0ff", color:"#5B5FEE" }}
                  >
                    {memberTasks.length} tasks
                  </span>
                </div>
                {memberTasks.length > 0 ? (
                  <div className="task-list">
                    {memberTasks.map((t) => (
                      <div key={t.id} className="task-row">
                        <div
                          className="task-status-dot"
                          style={{ background: statusColor[t.status] }}
                        />
                        <div className="task-info">
                          <div className="task-title">{t.title}</div>
                          <div className="task-meta">
                            {getProjectName(t.projectId) && (
                              <span className="task-project">
                                📁 {getProjectName(t.projectId)}
                              </span>
                            )}
                            {t.dueDate && (
                              <span>
                                📅 {new Date(t.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className="badge"
                          style={{
                            background: priorityColor[t.priority],
                            color: "#fff",
                          }}
                        >
                          {t.priority}
                        </span>
                        <span
                          className="badge"
                          style={{
                            background: statusColor[t.status] + "22",
                            color: statusColor[t.status],
                          }}
                        >
                          {t.status}
                        </span>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                          onClick={() => setAssignTask(t)}
                        >
                          Re-assign
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#aaa",
                      padding: "8px 16px",
                    }}
                  >
                    No tasks assigned.
                  </p>
                )}
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="empty-state">Add team members first.</p>
          )}
        </div>
      )}

      {/* Unassigned Tab */}
      {activeTab === "unassigned" && (
        <div>
          {unassignedTasks.length > 0 ? (
            <div className="task-list">
              {unassignedTasks.map((t) => (
                <div key={t.id} className="task-row">
                  <div
                    className="task-status-dot"
                    style={{ background: statusColor[t.status] }}
                  />
                  <div className="task-info">
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">
                      {getProjectName(t.projectId) && (
                        <span className="task-project">
                          📁 {getProjectName(t.projectId)}
                        </span>
                      )}
                      {t.dueDate && (
                        <span>
                          📅 {new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: priorityColor[t.priority],
                      color: "#fff",
                    }}
                  >
                    {t.priority}
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: statusColor[t.status] + "22",
                      color: statusColor[t.status],
                    }}
                  >
                    {t.status}
                  </span>
                  <button
                    className="btn-primary"
                    style={{ fontSize: "11px", padding: "4px 10px" }}
                    onClick={() => setAssignTask(t)}
                  >
                    Assign →
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">All tasks are assigned.</p>
          )}
        </div>
      )}

      {/* Invitations Tab */}
      {activeTab === "expertise" && (
        <ExpertiseTab members={members} onRefresh={load} />
      )}
      {activeTab === "invitations" && (
        <div>
          {pendingInvites.length === 0 ? (
            <div className="empty-state">
              No pending invitations. Use "Invite Member" to invite teammates.
            </div>
          ) : (
            pendingInvites.map((inv) => (
              <div key={inv.id} className="pending-invite-row">
                <div className="pending-invite-avatar">
                  {inv.email[0].toUpperCase()}
                </div>
                <div className="pending-invite-info">
                  <div className="pending-invite-email">{inv.email}</div>
                  <div className="pending-invite-meta">
                    Role: <strong>{inv.role}</strong> · Expires:{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="pending-invite-badge">PENDING</span>
                <div className="pending-invite-actions">
                  <button
                    className="btn-secondary"
                    style={{ fontSize: "12px", padding: "4px 10px" }}
                    disabled={!!inviteRowBusy[inv.id]}
                    onClick={() => handleResendInvite(inv)}
                  >
                    {inviteRowBusy[inv.id] === "resend" ? "Resending…" : "Resend"}
                  </button>
                  <button
                    className="btn-icon"
                    style={{ color:"#D64545" }}
                    disabled={!!inviteRowBusy[inv.id]}
                    onClick={() => handleCancelInvite(inv)}
                    title="Cancel invitation"
                  >
                    {inviteRowBusy[inv.id] === "cancel" ? "…" : "✕"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showForm && (
        <MemberForm
          initial={editing}
          onSave={handleSave}
          saving={savingMember}
          isOwner={isOwner}
          onCancel={() => {
            if (savingMember) return;
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {assignTask && (
        <AssignModal
          task={assignTask}
          members={members}
          onSave={handleAssign}
          onCancel={() => setAssignTask(null)}
        />
      )}

      {/* F03 — Invite Member Modal */}
      {showInviteModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowInviteModal(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setShowInviteModal(false))?.(e); } }}
        >
          <div
            className="modal invite-modal"
            onClick={(e) => e.stopPropagation()} role="presentation"
          >
            <h2>✉️ Invite Team Member</h2>
            {inviteSuccess && (
              <div className="settings-success-banner">✅ {inviteSuccess}</div>
            )}
            {inviteError && <div className="auth-error">⚠️ {inviteError}</div>}
            <div className="form-group">
              <label htmlFor={"team-email-address"}>Email Address *</label>
              <input
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="colleague@company.com"
                type="email" id={"team-email-address"}
               
              />
            </div>
            <div className="form-group">
              <label htmlFor={"team-role-2"}>Role</label>
              <select
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, role: e.target.value }))
                } id={"team-role-2"}
              >
                <option value="MEMBER">
                  Member — Full access to projects and tasks
                </option>
                <option value="VIEWER">Viewer — Read-only access</option>
                <option value="ADMIN" disabled={!isOwner}>
                  {isOwner
                    ? "Admin — Can manage members and settings"
                    : "Admin — Manager only"}
                </option>
              </select>
              {!isOwner && (
                <span style={{ fontSize: "11px", color:"#64748b", marginTop: "4px", display: "block" }}>
                  Only the workspace Manager can invite someone as Admin.
                </span>
              )}
            </div>
            <div className="form-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteError("");
                  setInviteSuccess("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={inviteLoading}
                onClick={handleSendInvite}
              >
                {inviteLoading ? "⏳ Sending..." : "📨 Send Invitation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPERTISE & TALENT INTELLIGENCE COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ── Skill tag chip ────────────────────────────────────────────
function SkillChip({ skill, onRemove, color = "var(--brand-500)" }) {
  return (
    <span className="exp-skill-chip" style={{ background:`${color}15`, color, borderColor:`${color}33` }}>
      {skill}
      {onRemove && <button className="exp-chip-remove" onClick={onRemove}>×</button>}
    </span>
  );
}

// ── Inline tag input ──────────────────────────────────────────
function TagInput({ value = [], onChange, placeholder, color = "var(--brand-500)", id }) {
  const [input, setInput] = React.useState("");
  const add = () => {
    const v = input.trim();
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setInput("");
  };
  return (
    <div className="exp-tag-input-wrap">
      <div className="exp-tag-input-chips">
        {value.map(s => <SkillChip key={s} skill={s} color={color} onRemove={() => onChange(value.filter(x=>x!==s))} />)}
      </div>
      <div className="exp-tag-input-row">
        <input id={id} value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key===","){e.preventDefault();add();} }}
          placeholder={placeholder} className="exp-tag-input" />
        <button className="btn-secondary" style={{fontSize:"11px"}} onClick={add}>Add</button>
      </div>
    </div>
  );
}

// ── Member profile panel (extended with expertise) ────────────
function ExpertiseProfileModal({ member, onSave, onClose }) {
  const { show:toast } = useToast();
  const [form, setForm] = React.useState({
    title:          member.title || "",
    department:     member.department || "",
    location:       member.location || "",
    bio:            member.bio || "",
    skills:         member.skills || [],
    domains:        member.domains || [],
    mentorFor:      member.mentorFor || [],
    lookingToLearn: member.lookingToLearn || [],
    availability:   member.availability || "FULL",
    capacityPercent:member.capacityPercent ?? 100,
  });
  const [saving, setSaving] = React.useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleSave = async () => {
    setSaving(true);
    try {
      await expertiseApi.updateProfile(member.id, form);
      toast("Profile updated","success");
      onSave();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e=>e.target===e.currentTarget&&onClose())?.(e); } }}>
      <div className="modal" style={{maxWidth:560, maxHeight:"90vh", overflowY:"auto"}}>
        <h2>🧠 Expertise Profile — {member.name}</h2>

        <div className="form-row">
          <div className="form-group" style={{flex:2}}>
            <label htmlFor={"team-job-title"}>Job Title</label>
            <input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="e.g. Senior Engineer" id={"team-job-title"} />
          </div>
          <div className="form-group">
            <label htmlFor={"team-department"}>Department</label>
            <input value={form.department} onChange={e=>set("department",e.target.value)} placeholder="Engineering" id={"team-department"} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor={"team-location"}>Location</label>
            <input value={form.location} onChange={e=>set("location",e.target.value)} placeholder="London / UTC+0" id={"team-location"} />
          </div>
          <div className="form-group">
            <label htmlFor={"team-availability"}>Availability</label>
            <select value={form.availability} onChange={e=>set("availability",e.target.value)} id={"team-availability"}>
              <option value="FULL">Full availability</option>
              <option value="PARTIAL">Partial (part-time/shared)</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor={"team-capacity"}>Capacity %</label>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <input type="range" min={0} max={100} value={form.capacityPercent}
                onChange={e=>set("capacityPercent",Number(e.target.value))} style={{flex:1}} id={"team-capacity"} />
              <span style={{fontWeight:700,minWidth:36}}>{form.capacityPercent}%</span>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={"team-bio"}>Bio</label>
          <textarea rows={2} value={form.bio} onChange={e=>set("bio",e.target.value)}
            placeholder="Short professional bio…" id={"team-bio"} />
        </div>

        <div className="form-group">
          <label htmlFor="team-skills-input">Skills <span style={{color:"#64748b",fontWeight:400,fontSize:"11px"}}>(press Enter or comma to add)</span></label>
          <TagInput id="team-skills-input" value={form.skills} onChange={v=>set("skills",v)} placeholder="React, Python, ML…" color="var(--brand-500)" />
        </div>
        <div className="form-group">
          <label htmlFor="team-domains-input">Domains</label>
          <TagInput id="team-domains-input" value={form.domains} onChange={v=>set("domains",v)} placeholder="Frontend, Data, DevOps…" color="var(--purple)" />
        </div>
        <div className="form-group">
          <label htmlFor="team-mentor-for-input">Can Mentor In</label>
          <TagInput id="team-mentor-for-input" value={form.mentorFor} onChange={v=>set("mentorFor",v)} placeholder="Skills you can teach others…" color="var(--success)" />
        </div>
        <div className="form-group">
          <label htmlFor="team-looking-to-learn-input">Looking to Learn</label>
          <TagInput id="team-looking-to-learn-input" value={form.lookingToLearn} onChange={v=>set("lookingToLearn",v)} placeholder="Skills you want to develop…" color="var(--warning)" />
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Expert Finder ─────────────────────────────────────────────
function ExpertFinder() {
  const { show:toast } = useToast();
  const [query,     setQuery]     = React.useState("");
  const [results,   setResults]   = React.useState([]);
  const [aiQuery,   setAiQuery]   = React.useState("");
  const [aiResult,  setAiResult]  = React.useState(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [inferring, setInferring] = React.useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await expertiseApi.findExperts(query.trim(), 8);
      setResults(unwrapList(r));
    } finally { setSearching(false); }
  };

  const askAI = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    try {
      const r = await expertiseApi.aiRecommend(aiQuery.trim());
      // Was unwrapList(r) — /expertise/ai-recommend returns the
      // recommendation object directly; this has likely always shown
      // nothing.
      setAiResult(r.data);
    } finally { setAiLoading(false); }
  };

  const runInfer = async () => {
    setInferring(true);
    try {
      const r = await expertiseApi.infer();
      toast(`Expertise inferred for ${r.data.membersUpdated} members`, "success");
    } finally { setInferring(false); }
  };

  const AVAIL_COLOR = { FULL:"var(--success)", PARTIAL:"var(--warning)", UNAVAILABLE:"var(--danger)" };

  return (
    <div className="exp-finder">
      {/* AI Ask anything */}
      <div className="exp-ai-bar">
        <div className="exp-ai-bar-label">🤖 Ask AI about your team</div>
        <div className="exp-ai-bar-input">
          <input value={aiQuery} onChange={e=>setAiQuery(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&askAI()}
            placeholder="Who is best for a Python ML project? Who can mentor React?" />
          <button className="btn-primary" onClick={askAI} disabled={aiLoading||!aiQuery.trim()}>
            {aiLoading ? "⏳" : "Ask →"}
          </button>
        </div>
        {aiResult && (
          <div className="exp-ai-result">
            <div className="exp-ai-result-label">🤖 AI Recommendation</div>
            <div className="exp-ai-result-text">{aiResult.recommendation}</div>
          </div>
        )}
      </div>

      {/* Keyword search */}
      <div className="exp-search-bar">
        <div style={{display:"flex",gap:"8px",flex:1}}>
          <input value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&search()}
            placeholder="Search by skill (e.g. React, Python, DevOps, ML)…"
            className="exp-search-input" />
          <button className="btn-primary" onClick={search} disabled={searching||!query.trim()}>
            {searching ? "⏳" : "🔍 Find Experts"}
          </button>
        </div>
        <button className="btn-secondary" onClick={runInfer} disabled={inferring}
          title="Re-analyse task/doc activity to update expertise scores">
          {inferring ? "⏳ Inferring…" : "🔄 Infer from Activity"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="exp-results">
          <div className="exp-results-label">Found {results.length} expert{results.length!==1?"s":""} for "{query}"</div>
          <div className="exp-results-grid">
            {results.map((r,i) => {
              const m = r.member;
              const avColor = AVAIL_COLOR[m.availability] || "var(--success)";
              return (
                <div key={i} className="exp-result-card">
                  <div className="exp-result-rank">#{i+1}</div>
                  <div className="exp-result-avatar" style={{background:m.color||"var(--brand-500)"}}>
                    {m.name.slice(0,2).toUpperCase()}
                  </div>
                  <div className="exp-result-info">
                    <div className="exp-result-name">{m.name}</div>
                    {m.title && <div className="exp-result-title">{m.title}</div>}
                    {m.department && <div className="exp-result-dept">{m.department}</div>}
                    <div className="exp-result-badges">
                      {r.declaredSkill && <span className="exp-badge exp-badge-declared">✓ Declared</span>}
                      {r.inferredSkill && <span className="exp-badge exp-badge-inferred">⚡ Inferred</span>}
                      {r.canMentor     && <span className="exp-badge exp-badge-mentor">🎓 Can Mentor</span>}
                    </div>
                    <div className="exp-result-avail">
                      <span className="exp-avail-dot" style={{background:avColor}} />
                      <span style={{color:avColor,fontSize:"11px",fontWeight:700}}>{m.availability}</span>
                      {m.capacityPercent < 100 && (
                        <span style={{fontSize:"10px",color:"#64748b",marginLeft:"4px"}}>({m.capacityPercent}% capacity)</span>
                      )}
                    </div>
                  </div>
                  <div className="exp-result-score">
                    <div className="exp-score-num">{r.score}</div>
                    <div className="exp-score-label">score</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results.length === 0 && query && !searching && (
        <div className="exp-empty">No experts found for "{query}". Try inferring expertise from activity first.</div>
      )}
    </div>
  );
}

// ── Skill Map + Gaps ──────────────────────────────────────────
function SkillMapTab() {
  const [skillData,  setSkillData]  = React.useState(null);
  const [gapData,    setGapData]    = React.useState(null);
  const [activeView, setActiveView] = React.useState("map");

  React.useEffect(() => {
    // Both were unwrapList(r) — /expertise/skills and /expertise/gaps both
    // return a single object, not a list; this tab has likely always
    // rendered empty.
    expertiseApi.skillMap().then(r => setSkillData(r.data)).catch(() => {});
    expertiseApi.gaps().then(r => setGapData(r.data)).catch(() => {});
  }, []);

  const RISK_COLORS = { HIGH:"var(--danger)", MEDIUM:"var(--warning)", LOW:"var(--success)" };

  return (
    <div>
      <div className="exp-tab-switcher">
        {[["map","🗺 Team Skills"],["gaps","🚧 Skill Gaps"],["mentor","🎓 Mentor Matches"]].map(([v,l])=>(
          <button key={v} className={`sprint-filter-btn${activeView===v?" active":""}`}
            onClick={()=>setActiveView(v)}>{l}</button>
        ))}
      </div>

      {activeView === "map" && skillData && (
        <div>
          <div className="exp-stat-row">
            <div className="exp-stat-card">
              <div className="exp-stat-num" style={{color:"#5B5FEE"}}>{skillData.totalUniqueSkills}</div>
              <div className="exp-stat-label">Unique Skills</div>
            </div>
            <div className="exp-stat-card">
              <div className="exp-stat-num" style={{color:"#1E8E5A"}}>{skillData.totalMembers}</div>
              <div className="exp-stat-label">Team Members</div>
            </div>
          </div>
          <div className="exp-skill-cloud">
            {(skillData.skills || []).map((s,i) => {
              const size = Math.max(11, Math.min(22, 11 + s.count * 3));
              const opacity = Math.max(0.5, Math.min(1, 0.5 + s.count * 0.1));
              return (
                <span key={i} className="exp-skill-cloud-item"
                  style={{ fontSize:size, opacity, color: i%3===0?"var(--brand-500)":i%3===1?"var(--success)":"var(--warning)" }}
                  title={`${s.count} member${s.count!==1?"s":""}: ${s.owners.join(", ")}`}>
                  {s.skill}
                </span>
              );
            })}
            {(skillData.skills || []).length === 0 && (
              <div className="exp-empty">No skills declared yet. Add skills via the expertise profile on each member.</div>
            )}
          </div>
        </div>
      )}

      {activeView === "gaps" && gapData && (
        <div>
          <div className="exp-section-label">Skills needed by open tasks — not covered by any team member</div>
          {(gapData.skillGaps || []).length === 0
            ? <div className="exp-empty">No skill gaps detected — your team covers all task areas.</div>
            : (gapData.skillGaps || []).map((g,i) => (
              <div key={i} className="exp-gap-row">
                <div className="exp-gap-skill">{g.skill}</div>
                <div className="exp-gap-count">{g.openTaskCount} open task{g.openTaskCount!==1?"s":""}</div>
                <span className="exp-gap-priority" style={{
                  color: RISK_COLORS[g.priority], background:`${RISK_COLORS[g.priority]}15`}}>
                  {g.priority}
                </span>
                <div className="exp-gap-hint">Consider hiring or upskilling</div>
              </div>
            ))
          }
          {(gapData.mentorableSkills || []).length > 0 && (
            <>
              <div className="exp-section-label" style={{marginTop:"20px"}}>Learning opportunities (learner → available mentor)</div>
              {gapData.mentorableSkills.map((m,i) => (
                <div key={i} className="exp-gap-row">
                  <div className="exp-gap-skill">{m.learner}</div>
                  <div style={{fontSize:"12px",color:"#64748b"}}>wants to learn {m.skill}</div>
                  <span className="exp-badge exp-badge-mentor">{m.availableMentors} mentor{m.availableMentors!==1?"s":""} available</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeView === "mentor" && <MentorMatchTab />}
    </div>
  );
}

// ── Mentor Matching ───────────────────────────────────────────
function MentorMatchTab() {
  const [mentors,  setMentors]  = React.useState([]);
  const [filter,   setFilter]   = React.useState("");

  React.useEffect(() => {
    expertiseApi.mentors().then(r => setMentors(unwrapList(r))).catch(() => {});
  }, []);

  const filtered = filter
    ? mentors.filter(m => m.mentorFor.some(s => s.toLowerCase().includes(filter.toLowerCase())))
    : mentors;

  return (
    <div>
      <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
        <input value={filter} onChange={e=>setFilter(e.target.value)}
          placeholder="Filter by skill…" style={{maxWidth:280}} />
        {filter && <button className="btn-secondary" style={{fontSize:"11px"}} onClick={()=>setFilter("")}>Clear</button>}
      </div>

      {filtered.length === 0 && (
        <div className="exp-empty">
          No mentors declared yet. Members can add mentor skills via their Expertise Profile.
        </div>
      )}

      <div className="exp-mentor-grid">
        {filtered.map((m,i) => (
          <div key={i} className="exp-mentor-card">
            <div className="exp-mentor-avatar" style={{background:m.mentor.color||"var(--brand-500)"}}>
              {m.mentor.name.slice(0,2).toUpperCase()}
            </div>
            <div className="exp-mentor-info">
              <div className="exp-mentor-name">{m.mentor.name}</div>
              {m.mentor.title && <div className="exp-mentor-title">{m.mentor.title}</div>}
              <div className="exp-mentor-skills">
                {m.mentorFor.map(s => <SkillChip key={s} skill={s} color="var(--success)" />)}
              </div>
              {m.matchedLearners.length > 0 && (
                <div className="exp-mentor-matches">
                  🎯 Matched learners: <strong>{m.matchedLearners.join(", ")}</strong>
                </div>
              )}
            </div>
            <div className="exp-mentor-badge">
              <div className="exp-score-num" style={{color:"#1E8E5A"}}>{m.mentorFor.length}</div>
              <div className="exp-score-label">topics</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tribal Knowledge Risk ─────────────────────────────────────
function TribalKnowledgeTab() {
  const [risks, setRisks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    expertiseApi.tribalKnowledge().then(r => setRisks(unwrapList(r))).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const RISK_META = {
    HIGH:   { color:"#D64545", bg:"rgba(239,68,68,.1)",   icon:"🔴" },
    MEDIUM: { color:"#C17D22", bg:"rgba(245,158,11,.1)",  icon:"🟡" },
    LOW:    { color:"#1E8E5A", bg:"rgba(16,185,129,.1)",  icon:"🟢" },
  };

  if (loading) return <div className="exp-empty">Analysing tribal knowledge risks…</div>;

  return (
    <div>
      <div className="exp-section-label">
        Identifies people who are the sole owner of critical knowledge areas — a risk if they leave.
      </div>

      {risks.length === 0 ? (
        <div className="exp-empty">✅ No critical tribal knowledge risks detected. Knowledge is well distributed.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          {risks.map((r,i) => {
            const rm = RISK_META[r.risk] || RISK_META.MEDIUM;
            return (
              <div key={i} className="exp-tribal-card">
                <div className="exp-tribal-risk" style={{background:rm.bg,color:rm.color}}>
                  {rm.icon} {r.risk}
                </div>
                <div className="exp-tribal-body">
                  <div className="exp-tribal-name">{r.person}</div>
                  <div className="exp-tribal-desc">{r.description}</div>
                  {r.areas && r.areas.length > 0 && (
                    <div className="exp-tribal-areas">
                      {r.areas.map(a => <SkillChip key={a} skill={a} color="var(--gray-500)" />)}
                    </div>
                  )}
                </div>
                <div className="exp-tribal-action">
                  <div className="exp-score-num" style={{color:rm.color}}>
                    {r.taskCount || r.docCount || "—"}
                  </div>
                  <div className="exp-score-label">{r.type === "SOLE_TASK_OWNER" ? "tasks" : "docs"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="exp-tribal-hint">
        💡 Mitigation: pair-programming, doc reviews, cross-training, or updating mentor fields on expertise profiles.
      </div>
    </div>
  );
}

// ── Expertise Graph (SVG visual) ──────────────────────────────
function ExpertiseGraphTab() {
  const [graph,   setGraph]   = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [filter,  setFilter]  = React.useState("all"); // all | people | skills

  React.useEffect(() => {
    expertiseApi.graph().then(r => setGraph(r.data || {})).catch(()=>{}).finally(()=>setLoading(false));
  }, []);

  if (loading) return <div className="exp-empty">Building expertise graph…</div>;
  if (!graph || !graph.nodes || graph.nodes.length === 0)
    return <div className="exp-empty">No expertise data yet. Add skills to member profiles to generate the graph.</div>;

  // Simple force-layout approximation using fixed positions
  const people = graph.nodes.filter(n => n.type === "PERSON");
  const skills  = graph.nodes.filter(n => n.type === "SKILL");
  const W = 700, H = 420;
  const CX = W/2, CY = H/2;

  // People in outer circle, skills in inner cluster
  const personPos = {};
  people.forEach((p,i) => {
    const angle = (i / people.length) * 2 * Math.PI - Math.PI/2;
    const r = Math.min(CX, CY) * 0.7;
    personPos[p.id] = { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  });

  const skillPos = {};
  skills.forEach((s,i) => {
    const angle = (i / Math.max(skills.length,1)) * 2 * Math.PI;
    const r = Math.min(CX, CY) * 0.3;
    skillPos[s.id] = { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  });

  const getPos = (id) => personPos[id] || skillPos[id] || { x: CX, y: CY };

  const showPeople = filter !== "skills";
  const showSkills = filter !== "people";

  return (
    <div>
      <div style={{display:"flex",gap:"6px",marginBottom:"12px",alignItems:"center",flexWrap:"wrap"}}>
        {[["all","All"],["people","People only"],["skills","Skills only"]].map(([v,l])=>(
          <button key={v} className={`sprint-filter-btn${filter===v?" active":""}`}
            onClick={()=>setFilter(v)}>{l}</button>
        ))}
        <span style={{fontSize:"11px",color:"#64748b",marginLeft:"8px"}}>
          {people.length} people · {skills.length} skill nodes · {graph.edges.length} connections
        </span>
      </div>

      <div className="exp-graph-wrap">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="exp-graph-svg">
          {/* Edges */}
          {graph.edges.map((e,i) => {
            const from = getPos(e.from), to = getPos(e.to);
            if (!from || !to) return null;
            const show = (e.from.startsWith("person_") || e.to.startsWith("person_")) && showPeople
              || (e.from.startsWith("skill_") && e.to.startsWith("skill_")) && showSkills;
            if (!show) return null;
            const color = e.type === "SHARES_SKILL" ? "var(--brand-500)"
              : e.type === "MENTORS" ? "var(--success)" : "var(--gray-400)";
            return (
              <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={color} strokeWidth={e.type==="SHARES_SKILL" ? e.weight : 1}
                strokeOpacity={0.4} />
            );
          })}

          {/* People nodes */}
          {showPeople && people.map(p => {
            const pos = personPos[p.id];
            if (!pos) return null;
            return (
              <g key={p.id}>
                <circle cx={pos.x} cy={pos.y} r={22} fill={p.color||"var(--brand-500)"} opacity={0.9} />
                <text x={pos.x} y={pos.y+4} textAnchor="middle" fontSize={11} fill="white" fontWeight="bold">
                  {p.label.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                </text>
                <text x={pos.x} y={pos.y+34} textAnchor="middle" fontSize={10} fill="var(--gray-700)">
                  {p.label.split(" ")[0]}
                </text>
              </g>
            );
          })}

          {/* Skill nodes */}
          {showSkills && skills.map(s => {
            const pos = skillPos[s.id];
            if (!pos) return null;
            const relatedEdges = graph.edges.filter(e => e.from === s.id || e.to === s.id).length;
            const r = Math.max(8, Math.min(18, 6 + relatedEdges * 2));
            return (
              <g key={s.id}>
                <circle cx={pos.x} cy={pos.y} r={r} fill="var(--success)" opacity={0.8} />
                <text x={pos.x} y={pos.y + r + 12} textAnchor="middle" fontSize={9} fill="var(--success)">
                  {s.label.slice(0,12)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="exp-graph-legend">
          <span>⬤ <span style={{color:"#5B5FEE"}}>Person</span></span>
          <span>⬤ <span style={{color:"#1E8E5A"}}>Skill</span></span>
          <span>── <span style={{color:"#5B5FEE"}}>Shared skill</span></span>
          <span>── <span style={{color:"#1E8E5A"}}>Mentor link</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Member card with expertise preview ────────────────────────
function MemberExpertiseCard({ member, onEditProfile }) {
  const AVAIL_COLOR = { FULL:"var(--success)", PARTIAL:"var(--warning)", UNAVAILABLE:"var(--danger)" };
  const avColor = AVAIL_COLOR[member.availability] || "var(--success)";

  return (
    <div className="exp-member-card">
      <div className="exp-member-avatar" style={{background:member.color||"var(--brand-500)"}}>
        {member.name.slice(0,2).toUpperCase()}
      </div>
      <div className="exp-member-body">
        <div className="exp-member-name">{member.name}</div>
        {member.title && <div className="exp-member-title">{member.title}</div>}
        {member.department && <div className="exp-member-dept">🏢 {member.department}</div>}
        {member.location  && <div className="exp-member-dept">📍 {member.location}</div>}
        {member.bio && <div className="exp-member-bio">{member.bio}</div>}

        {(member.skills || []).length > 0 && (
          <div className="exp-member-skills">
            {(member.skills || []).slice(0,5).map(s => <SkillChip key={s} skill={s} color="var(--brand-500)" />)}
            {(member.skills || []).length > 5 && (
              <span className="exp-more-badge">+{member.skills.length-5}</span>
            )}
          </div>
        )}
        {(member.skills || []).length === 0 && (
          <div style={{fontSize:"11px",color:"#94a3b8"}}>No skills declared yet</div>
        )}

        {(member.mentorFor || []).length > 0 && (
          <div className="exp-member-mentor">
            🎓 Mentors: {member.mentorFor.slice(0,3).join(", ")}
            {member.mentorFor.length > 3 && ` +${member.mentorFor.length-3}`}
          </div>
        )}

        <div className="exp-member-footer">
          <span className="exp-avail-pill" style={{background:`${avColor}18`,color:avColor}}>
            ● {member.availability || "FULL"}
          </span>
          {member.capacityPercent < 100 && (
            <span style={{fontSize:"10px",color:"#64748b"}}>{member.capacityPercent}% capacity</span>
          )}
        </div>
      </div>
      <button className="btn-secondary" style={{fontSize:"11px",alignSelf:"flex-start",flexShrink:0}}
        onClick={()=>onEditProfile(member)}>
        ✏️ Profile
      </button>
    </div>
  );
}

// ── Main Expertise Tab ────────────────────────────────────────
function ExpertiseTab({ members, onRefresh }) {
  const [expertiseView, setExpertiseView] = React.useState("directory");
  const [editingProfile, setEditingProfile] = React.useState(null);

  const VIEWS = [
    { id:"directory",  label:"👥 Directory"     },
    { id:"finder",     label:"🔍 Expert Finder" },
    { id:"skills",     label:"🗺 Skill Map"     },
    { id:"tribal",     label:"⚠️ Tribal Risk"  },
    { id:"graph",      label:"🕸 Graph"         },
  ];

  return (
    <div>
      <div className="exp-view-tabs">
        {VIEWS.map(v=>(
          <button key={v.id} className={`sprint-filter-btn${expertiseView===v.id?" active":""}`}
            onClick={()=>setExpertiseView(v.id)}>{v.label}</button>
        ))}
      </div>

      {expertiseView === "directory" && (
        <div>
          <div className="exp-section-label">
            {members.filter(m=>m.skills?.length).length} of {members.length} members have declared skills
          </div>
          <div className="exp-member-grid">
            {members.map(m => (
              <MemberExpertiseCard key={m.id} member={m}
                onEditProfile={setEditingProfile} />
            ))}
            {members.length === 0 && <div className="exp-empty">No team members yet.</div>}
          </div>
        </div>
      )}

      {expertiseView === "finder"  && <ExpertFinder  members={members} />}
      {expertiseView === "skills"  && <SkillMapTab />}
      {expertiseView === "tribal"  && <TribalKnowledgeTab />}
      {expertiseView === "graph"   && <ExpertiseGraphTab />}

      {editingProfile && (
        <ExpertiseProfileModal
          member={editingProfile}
          onSave={onRefresh}
          onClose={()=>setEditingProfile(null)} />
      )}
    </div>
  );
}