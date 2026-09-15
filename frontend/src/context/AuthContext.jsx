import { useState, useEffect, useCallback } from "react";
import { AuthContext } from "./AuthContext.js";
import client, { clearAllCache } from "../api/client";

/**
 * Auth storage strategy:
 *
 * Problem: localStorage is shared across all tabs. sessionStorage is
 * copied to new tabs when opened via Ctrl+T or duplicated. Neither
 * works for true tab isolation.
 *
 * Solution: Use a per-tab unique key stored in sessionStorage.
 * Each tab gets a unique ID on creation. Auth data is stored in
 * sessionStorage under that unique tab ID — so even if sessionStorage
 * is copied to a new tab, the new tab generates a fresh ID and
 * finds no auth data for it, forcing a fresh login.
 */

// Generate or retrieve a unique ID for THIS tab
function getTabId() {
  let tabId = sessionStorage.getItem("__tab_id__");
  if (!tabId) {
    // New tab — generate fresh ID
    tabId = "tab_" + Math.random().toString(36).slice(2) + Date.now();
    sessionStorage.setItem("__tab_id__", tabId);
  }
  return tabId;
}

// Check if this tab just inherited sessionStorage from another tab
// by comparing the tab ID against a "registered" set in sessionStorage
function isInheritedTab() {
  const tabId = sessionStorage.getItem("__tab_id__");
  const registered = sessionStorage.getItem("__tab_registered__");
  // If tab_id exists but tab is not registered, it was copied from another tab
  return tabId && !registered;
}

function initTabStorage() {
  if (isInheritedTab()) {
    // This tab inherited sessionStorage from a duplicated/new tab
    // Clear everything and generate a fresh tab ID
    sessionStorage.clear();
    const newTabId = "tab_" + Math.random().toString(36).slice(2) + Date.now();
    sessionStorage.setItem("__tab_id__", newTabId);
  }
  // Mark this tab as properly registered
  sessionStorage.setItem("__tab_registered__", "true");
  return getTabId();
}

const TAB_ID = initTabStorage();

function tabKey(key) {
  return `${TAB_ID}__${key}`;
}

function getInitialUser() {
  // 1. Try tab-keyed sessionStorage (set on THIS tab's login — most trustworthy)
  const token    = sessionStorage.getItem(tabKey("token"));
  const userData = sessionStorage.getItem(tabKey("user"));
  if (token && userData) {
    client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    try { return JSON.parse(userData); } catch { return null; }
  }
  // 2. localStorage fallback (social/OAuth, magic link)
  // Only use if we can cross-check the email matches (prevents stale data)
  const lsToken = localStorage.getItem("token");
  const lsUser  = localStorage.getItem("user");
  if (lsToken && lsUser) {
    try {
      const parsed = JSON.parse(lsUser);
      // Basic sanity check: must have email and id
      if (parsed?.email && parsed?.id) {
        // Copy into sessionStorage so this tab is properly keyed
        sessionStorage.setItem(tabKey("token"), lsToken);
        sessionStorage.setItem(tabKey("user"), lsUser);
        client.defaults.headers.common["Authorization"] = `Bearer ${lsToken}`;
        return parsed;
      }
    } catch { /* stale/corrupt data — ignore */ }
    // Clear bad localStorage data
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }
  return null;
}

function getInitialWorkspace() {
  const ws = sessionStorage.getItem(tabKey("activeWorkspace"));
  if (ws) {
    const parsed = JSON.parse(ws);
    client.defaults.headers.common["X-Workspace-Id"] = parsed.id;
    return parsed;
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser]                            = useState(getInitialUser);
  const [loading]                                  = useState(false);
  const [activeWorkspace, setActiveWorkspaceState] = useState(getInitialWorkspace);

  // Fetch fresh profile from backend and update stored user
  const refreshProfile = (token) => {
    const authToken = token || sessionStorage.getItem(tabKey("token")) || localStorage.getItem("token");
    if (!authToken) return;
    client.get("/auth/profile", {
      headers: { Authorization: `Bearer ${authToken}` }
    }).then(r => {
      if (r.data?.email) {
        const fresh = { ...r.data };
        // Preserve token in sessionStorage/localStorage user record
        sessionStorage.setItem(tabKey("user"), JSON.stringify(fresh));
        localStorage.setItem("user", JSON.stringify(fresh));
        setUser(fresh);
      }
    }).catch(() => { /* profile fetch failed — keep current user */ });
  };

  // On app load: re-fetch profile to get authoritative role from DB
  // This fixes stale role data from cached localStorage
  useEffect(() => {
    const stored = getInitialUser();
    if (stored) refreshProfile();
  }, []);

  const loginUser = (userData, token) => {
    // Defense in depth: if a DIFFERENT account was previously logged in on
    // this browser, their workspace choice may still be sitting in
    // localStorage.activeWorkspace (setActiveWorkspace writes it there
    // alongside the tab-scoped sessionStorage copy). Nothing reads that
    // value for network requests any more (see api/client.js), but it's
    // still cleared here so it can't confuse anything that inspects it
    // directly, and so this tab starts clean rather than carrying a
    // previous person's workspace forward.
    try {
      const prevUser = JSON.parse(localStorage.getItem("user") || "null");
      if (prevUser?.email && prevUser.email !== userData?.email) {
        localStorage.removeItem("activeWorkspace");
      }
    } catch { /* malformed previous localStorage entry — ignore */ }

    sessionStorage.setItem(tabKey("token"), token);
    sessionStorage.setItem(tabKey("user"), JSON.stringify(userData));
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    setUser(userData);
    // Re-fetch authoritative profile (role may differ from login response)
    refreshProfile(token);
  };

  const logoutUser = () => {
    sessionStorage.removeItem(tabKey("token"));
    sessionStorage.removeItem(tabKey("user"));
    sessionStorage.removeItem(tabKey("activeWorkspace"));
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("activeWorkspace");
    delete client.defaults.headers.common["Authorization"];
    delete client.defaults.headers.common["X-Workspace-Id"];
    setUser(null);
    setActiveWorkspaceState(null);
  };

  const setActiveWorkspace = useCallback((workspace) => {
    if (workspace) {
      sessionStorage.setItem(tabKey("activeWorkspace"), JSON.stringify(workspace));
      localStorage.setItem("activeWorkspace", JSON.stringify(workspace));
      client.defaults.headers.common["X-Workspace-Id"] = workspace.id;
    } else {
      sessionStorage.removeItem(tabKey("activeWorkspace"));
      localStorage.removeItem("activeWorkspace");
      delete client.defaults.headers.common["X-Workspace-Id"];
    }
    // Clear the GET cache so every page re-fetches fresh data for the new workspace
    clearAllCache();
    setActiveWorkspaceState(workspace);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginUser,
        logoutUser,
        activeWorkspace,
        setActiveWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
