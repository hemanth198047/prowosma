import { useEffect, useState, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useRole } from "../hooks/useRole";
import { getMyWorkspaces } from "../api/workspaces";

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, activeWorkspace, setActiveWorkspace } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  const [wsChecked, setWsChecked] = useState(false);
  // Distinguishes "the account genuinely has zero workspaces" (true empty
  // list, send them to workspace-setup to create one) from "we couldn't
  // tell" (request failed — a stale X-Workspace-Id header from a
  // previous tab's session getting 403'd, a network hiccup, etc). Treating
  // the latter as "zero workspaces" was the bug: an invited Member with a
  // real membership could land on "create a workspace" purely because a
  // lookup failed, not because they had nothing to select.
  const [wsError, setWsError] = useState(false);

  const loadWorkspaces = useCallback(() => {
    setWsError(false);
    return getMyWorkspaces()
      .then(res => {
        const list = res.data || [];
        if (list.length > 0) {
          setActiveWorkspace(list[0]); // auto-select first workspace
        }
      })
      .catch(() => setWsError(true))
      .finally(() => setWsChecked(true));
  }, [setActiveWorkspace]);

  useEffect(() => {
    // If user is logged in but no active workspace, try to auto-select the first one
    if (!user || activeWorkspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync early-return branch mirrors the async branch's .finally(), which also sets this
      setWsChecked(true);
      return;
    }
    loadWorkspaces();
  }, [user, activeWorkspace, loadWorkspaces]);

  if (loading || !wsChecked || (adminOnly && roleLoading)) {
    return <div className="empty-state">Loading…</div>;
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!activeWorkspace) {
    if (wsError) {
      // Couldn't confirm workspace membership — most likely a transient
      // issue, not a genuinely empty account. Offer a retry instead of
      // silently funnelling the person into "create a new workspace",
      // which would be the wrong outcome for anyone who actually already
      // belongs to one.
      return (
        <div className="empty-state" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div>Couldn't load your workspaces. This is usually temporary.</div>
          <button className="btn-secondary" onClick={() => { setWsChecked(false); loadWorkspaces(); }}>
            Try again
          </button>
        </div>
      );
    }
    return <Navigate to="/workspace-setup" replace />;
  }
  // Not shown in the sidebar for non-admins either (see CanDo action="adminOnly"
  // on the nav link) - this catches someone typing the URL directly instead.
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}
