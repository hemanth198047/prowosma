import { useContext } from "react";
import { RoleContext } from "../context/RoleContext";

/**
 * Returns the current user's role in the active workspace.
 * Possible values: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null
 *
 * Usage:
 *   const { role, isOwner, isAdmin, canEdit, canView } = useRole();
 */
export const useRole = () => {
  const context = useContext(RoleContext);
  return context || {
    role: "MEMBER",
    isOwner: false,
    isAdmin: false,
    canEdit: true,
    canCreate: true,
    canDelete: true,
    canView: true,
    canManageSettings: false,
  };
};
