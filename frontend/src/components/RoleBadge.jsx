/**
 * Displays a colored role badge.
 * Usage: <RoleBadge role="OWNER" />
 */
export default function RoleBadge({ role, memberRole }) {
  if (!role) return null;
  const cls = {
    OWNER:  "role-badge role-owner",
    ADMIN:  "role-badge role-admin",
    MEMBER: "role-badge role-member",
    EDITOR: "role-badge role-editor",
    VIEWER: "role-badge role-viewer",
  }[role] || "role-badge role-member";

  const label = {
    OWNER:  "Manager",
    ADMIN:  "Admin",
    MEMBER: "Member",
    EDITOR: "Editor",
    VIEWER: "Viewer",
  }[role] || role;

  // The workspace creator is the Manager; if their member role is Admin (or similar) show that too.
  const extra = role === "OWNER" && memberRole && memberRole !== "OWNER" ? ` · ${{ ADMIN: "Admin", MEMBER: "Member", EDITOR: "Editor", VIEWER: "Viewer" }[memberRole] || memberRole}` : "";
  return <span className={cls}>{label}{extra}</span>;
}
