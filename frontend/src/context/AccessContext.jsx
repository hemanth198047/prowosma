import { useEffect, useMemo, useState } from "react";
import { AccessContext } from "./AccessContext.js";
import { useAuth } from "../hooks/useAuth";
import { getMyAccess } from "../api/access";

/**
 * What the signed-in person may see and do in the active workspace (department / assigned-work access).
 * `restricted` is true only when the backend says so; if the lookup fails we assume nothing restricted
 * and let the API's own refusals speak — the server is the source of truth, this just shapes the UI.
 */
export function AccessProvider({ children }) {
  const { user, activeWorkspace } = useAuth();
  const [state, setState] = useState({ loading: true, restricted: false, data: null });

  useEffect(() => {
    let cancelled = false;
    if (!user || !activeWorkspace?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to look up without a signed-in user and workspace
      setState({ loading: false, restricted: false, data: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    getMyAccess()
      .then((res) => { if (!cancelled) setState({ loading: false, restricted: !!res.data?.restricted, data: res.data || null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, restricted: false, data: null }); });
    return () => { cancelled = true; };
  }, [user, activeWorkspace?.id]);

  const value = useMemo(() => ({
    loading: state.loading,
    restricted: state.restricted,
    enabled: !!state.data?.accessControlEnabled,
    mode: state.data?.mode || "ALL",
    profileName: state.data?.profileName || "",
    departmentIds: state.data?.departmentIds || [],
    departmentAdmin: !!state.data?.departmentAdmin,
    capabilities: state.data?.capabilities || [],
    can: (capability) => !state.restricted || (state.data?.capabilities || []).includes(capability),
  }), [state]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}
