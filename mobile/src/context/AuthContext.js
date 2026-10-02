import { createContext, useState, useEffect, useCallback, useContext } from 'react';
import {
  getToken,
  setToken,
  getStoredUser,
  setStoredUser,
  getActiveWorkspace,
  setActiveWorkspace as persistActiveWorkspace,
  clearSession,
  setUnauthorizedHandler,
} from '../api/client';
import { getMyWorkspaces } from '../api/workspaces';
import { getProfile } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState(null);
  const [loading, setLoading] = useState(true);

  // On app launch: restore whatever session AsyncStorage already has,
  // same idea as the web app's getInitialUser()/getInitialWorkspace(),
  // just async because AsyncStorage itself is async (unlike
  // localStorage/sessionStorage on web).
  useEffect(() => {
    (async () => {
      const [token, storedUser, storedWorkspace] = await Promise.all([
        getToken(),
        getStoredUser(),
        getActiveWorkspace(),
      ]);
      if (token && storedUser) {
        setUser(storedUser);
        if (storedWorkspace) setActiveWorkspaceState(storedWorkspace);
        // Re-fetch authoritative profile in the background — role/name
        // may have changed server-side since the last login.
        getProfile()
          .then((r) => {
            if (r.data?.email) {
              setUser(r.data);
              setStoredUser(r.data);
            }
          })
          .catch(() => {
            // Token invalid/expired — the response interceptor already
            // handles clearing storage and firing onUnauthorized for us.
          });
      }
      setLoading(false);
    })();
  }, []);

  // Wired to the axios client's 401 handler (see api/client.js) so an
  // expired/revoked session anywhere in the app routes back to Login
  // without every single screen needing its own error handling for it.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setActiveWorkspaceState(null);
    });
  }, []);

  const loginUser = useCallback(async (userData, token) => {
    await setToken(token);
    await setStoredUser(userData);
    setUser(userData);

    // Auto-select the first workspace, same behavior as the web app's
    // ProtectedRoute — most users belong to exactly one.
    try {
      const res = await getMyWorkspaces();
      const list = res.data || [];
      if (list.length > 0) {
        await persistActiveWorkspace(list[0]);
        setActiveWorkspaceState(list[0]);
      }
    } catch {
      // Non-fatal — screens can prompt to pick/create a workspace if
      // this stays null.
    }
  }, []);

  const logoutUser = useCallback(async () => {
    await clearSession();
    setUser(null);
    setActiveWorkspaceState(null);
  }, []);

  const setActiveWorkspace = useCallback(async (workspace) => {
    await persistActiveWorkspace(workspace);
    setActiveWorkspaceState(workspace);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, activeWorkspace, loading, loginUser, logoutUser, setActiveWorkspace }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
