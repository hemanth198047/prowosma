import { useState, useEffect } from "react";
import { RoleContext } from "./RoleContext.js";
import { useAuth } from "../hooks/useAuth";
import client from "../api/client";

export function RoleProvider({ children }) {
  const { user, activeWorkspace } = useAuth();
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolutionError, setResolutionError] = useState(false);
  // Which user+workspace the current role belongs to. Right after sign-in
  // finishes there is one render where user/workspace are known but the
  // effect below hasn't run yet; without this, `loading` read false there
  // and admin-only routes (/admin, /access-control) bounced an admin who
  // opened them directly (or refreshed) to the Dashboard.
  const key = user && activeWorkspace ? `${user.email}|${activeWorkspace.id}|${activeWorkspace.ownerEmail}` : null;
  const [resolvedFor, setResolvedFor] = useState(null);

  useEffect(() => {
    const resolveRole = async () => {
      setResolutionError(false);
      if (!user || !activeWorkspace) {
        setRole(null);
        setResolvedFor(null);
        setLoading(false);
        return;
      }

      // OWNER: this workspace was created by this user
      if (activeWorkspace.ownerEmail === user.email) {
        setRole("OWNER");
        setResolvedFor(key);
        setLoading(false);
        return;
      }

      // Look up TeamMember record — pass workspaceId explicitly so the backend
      // scopes correctly regardless of X-Workspace-Id header timing
      try {
        const res = await client.get(
          `/team/by-email?email=${encodeURIComponent(user.email)}&workspaceId=${activeWorkspace.id}`
        );
        if (res.data?.role) {
          setRole(res.data.role);
        } else {
          // A 200 with no role is unexpected but not a hard failure — still
          // worth flagging rather than silently defaulting to a role that
          // grants write access.
          setRole(null);
          setResolutionError(true);
        }
      } catch {
        // Deliberately NOT defaulting to "MEMBER" here — a transient
        // network error or backend hiccup shouldn't silently upgrade what
        // might actually be a Viewer into looking like they have write
        // access. null + resolutionError=true lets consumers show "role
        // unknown" instead of a plausible-but-possibly-wrong value.
        setRole(null);
        setResolutionError(true);
      } finally {
        setResolvedFor(key);
        setLoading(false);
      }
    };
    resolveRole();
    // Deliberately depend on the specific primitive fields actually read
    // (email/id/ownerEmail), not the whole user/activeWorkspace objects —
    // those objects can get new references from useAuth() on renders where
    // none of these values actually changed, which would otherwise cause
    // an unnecessary role re-fetch on every such render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, activeWorkspace?.id, activeWorkspace?.ownerEmail]);

  const isOwner           = role === "OWNER";
  const isAdmin           = role === "OWNER" || role === "ADMIN";
  // While role is unresolved (null — still loading, or resolution failed),
  // write-permissions default to false rather than true. Erring toward
  // "can't edit yet" is the safe direction; the previous default of
  // role="MEMBER" erred the other way, quietly granting write access
  // before/without ever confirming that was correct.
  const resolved          = role !== null;
  const canCreate         = resolved && role !== "VIEWER";
  const canEdit           = resolved && role !== "VIEWER";
  const canDelete         = resolved && role !== "VIEWER";
  const canView           = true;
  const canManageSettings = role === "OWNER" || role === "ADMIN";
  const canManageMembers  = role === "OWNER" || role === "ADMIN";

  return (
    <RoleContext.Provider value={{
      role, loading: loading || (key !== null && resolvedFor !== key), resolutionError, resolved,
      isOwner, isAdmin,
      canCreate, canEdit, canDelete, canView,
      canManageSettings, canManageMembers,
    }}>
      {children}
    </RoleContext.Provider>
  );
}
