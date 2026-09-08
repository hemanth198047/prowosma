/**
 * Displays a colored role badge.
 * Usage: <RoleBadge role="OWNER" />
 */
export default function RoleBadge({ role }) {
  if (!role) return null;
  const cls = {
    OWNER:  "role-badge role-owner",
    ADMIN:  "role-badge role-admin",
    MEMBER: "role-badge role-member",
    VIEWER: "role-badge role-viewer",
  }[role] || "role-badge role-member";

  const label = {
    OWNER:  "👑 Owner",
    ADMIN:  "🛡️ Admin",
    MEMBER: "👤 Member",
    VIEWER: "👁️ Viewer",
  }[role] || role;

  return <span className={cls}>{label}</span>;
}
