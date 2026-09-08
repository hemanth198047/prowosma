import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useRole } from "../hooks/useRole";
import { getMyWorkspaces } from "../api/workspaces";

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, activeWorkspace, setActiveWorkspace } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  const [wsChecked, setWsChecked] = useState(false);

  useEffect(() => {
    // If user is logged in but no active workspace, try to auto-select the first one
    if (!user || activeWorkspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync early-return branch mirrors the async branch's .finally(), which also sets this
      setWsChecked(true);
      return;
    }
    // Fetch workspaces and auto-select the first one
    getMyWorkspaces()
      .then(res => {
        const list = res.data || [];
        if (list.length > 0) {
          setActiveWorkspace(list[0]); // auto-select first workspace
        }
      })
      .catch(() => {})
      .finally(() => setWsChecked(true));
  }, [user, activeWorkspace, setActiveWorkspace]);

  if (loading || !wsChecked || (adminOnly && roleLoading)) {
    return <div className="empty-state">Loading…</div>;
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!activeWorkspace) return <Navigate to="/workspace-setup" replace />;
  // Not shown in the sidebar for non-admins either (see CanDo action="adminOnly"
  // on the nav link) - this catches someone typing the URL directly instead.
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}
