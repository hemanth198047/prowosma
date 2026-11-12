import { useRole } from "../hooks/useRole";

/**
 * Wrapper component that conditionally renders children
 * based on the current user's role.
 *
 * Usage:
 *   <CanDo action="create">
 *     <button>+ New Project</button>
 *   </CanDo>
 *
 *   <CanDo action="delete">
 *     <button onClick={handleDelete}>🗑️</button>
 *   </CanDo>
 *
 *   <CanDo action="manageSettings">
 *     <NavLink to="/workspace-settings">Settings</NavLink>
 *   </CanDo>
 *
 * Actions:
 *   create | edit | delete | manageSettings | manageMembers
 *
 * If the user doesn't have permission, renders nothing (or fallback).
 */
export default function CanDo({ action, children, fallback = null }) {
  const role = useRole();

  const allowed = {
    create:         role.canCreate,
    edit:           role.canEdit,
    delete:         role.canDelete,
    view:           role.canView,
    manageSettings: role.canManageSettings,
    manageMembers:  role.canManageMembers,
    adminOnly:      role.isAdmin,
    ownerOnly:      role.isOwner,
  };

  if (!allowed[action]) return fallback;
  return children;
}
