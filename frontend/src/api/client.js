import axios from "axios";

/* ── Global "background work in progress" tracker ────────────────
 * Every real network call (not served from the GET cache) increments
 * this counter on the way out and decrements it on the way back,
 * success or failure. GlobalLoadingBar subscribes to it so the whole
 * app gets a visible "something is happening" indicator automatically,
 * without every single handler needing to manage its own loading state.
 */
let activeRequests = 0;
const loadingListeners = new Set();

function notifyLoadingListeners() {
  loadingListeners.forEach((cb) => cb());
}

export function subscribeToLoading(callback) {
  loadingListeners.add(callback);
  return () => loadingListeners.delete(callback);
}

export function getActiveRequestCount() {
  return activeRequests;
}

function beginTrackedRequest(config) {
  if (!config._servedFromCache) {
    activeRequests += 1;
    notifyLoadingListeners();
  }
}

function endTrackedRequest(config) {
  if (config && !config._servedFromCache) {
    activeRequests = Math.max(0, activeRequests - 1);
    notifyLoadingListeners();
  }
}

const client = axios.create({
  // Was hardcoded to "http://localhost:9090/api" unconditionally — worked
  // fine for local `npm run dev` (where the backend really is on
  // localhost:9090), but breaks the moment frontend and backend run in
  // separate containers, since the frontend container's "localhost" is
  // not the backend container. VITE_API_URL was already an established
  // convention elsewhere in this codebase (useWebSocket.js,
  // DeveloperPortal.jsx) as a *bare origin* with no /api suffix — matching
  // that here rather than inventing a second, incompatible convention.
  // Falls back to the exact original hardcoded value, so local dev
  // behavior is completely unchanged unless something explicitly opts in.
  baseURL: (import.meta.env.VITE_API_URL || "http://localhost:9090") + "/api",
  headers: { "Content-Type": "application/json" },
  timeout: 60000,
});

/* ── GET cache (30s TTL) ─────────────────────────────────────── */
const cache = new Map();
const CACHE_TTL = 30_000;

/* ── Token helper — reads from sessionStorage using tab key ──── */
export function getToken() {
  // 1. sessionStorage — tab-keyed token set by AuthContext on regular login
  for (const key of Object.keys(sessionStorage)) {
    if (key.endsWith("__token") || key === "token") {
      const val = sessionStorage.getItem(key);
      if (val) return val;
    }
  }
  // 2. localStorage — set by social/OAuth login and magic link flows
  const lsToken = localStorage.getItem("token");
  if (lsToken) return lsToken;
  return null;
}

function getWorkspaceId() {
  // sessionStorage — tab-keyed workspace, and ONLY this. See
  // AuthContext.jsx's tab-isolation comment: activeWorkspace is
  // deliberately per-tab, not shared across the browser.
  //
  // This used to also fall back to localStorage.activeWorkspace. That's
  // exactly what AuthContext.getInitialWorkspace() was written to avoid —
  // but this fallback bypassed that protection at the network layer.
  // Concretely: log in as User A (their workspace gets written to
  // localStorage as a byproduct of setActiveWorkspace), then in a NEW tab
  // log in as invited User B, who has never selected a workspace in THIS
  // tab. Every request from B's tab — including the very first
  // "GET /api/workspaces" call used to auto-select B's own workspace —
  // would silently carry User A's stale workspace id in X-Workspace-Id.
  // The backend's WorkspaceFilter correctly rejects that (B isn't a
  // member of A's workspace) with a 403, ProtectedRoute swallows the
  // error, and B lands on "create/select a workspace" even though they
  // already belong to one. Removing the fallback here makes the header
  // consistently reflect only what THIS tab actually chose.
  for (const key of Object.keys(sessionStorage)) {
    if (key.endsWith("__activeWorkspace")) {
      try {
        const ws = JSON.parse(sessionStorage.getItem(key));
        if (ws?.id) return ws.id;
      } catch { /* malformed sessionStorage entry — skip and fall through */ }
    }
  }
  return null;
}

/* ── Request interceptor ─────────────────────────────────────── */
client.interceptors.request.use((config) => {
  // Re-attach token on every request in case client.defaults was reset by HMR
  if (!config.headers["Authorization"]) {
    const token = getToken();
    if (token) config.headers["Authorization"] = `Bearer ${token}`;
  }

  // Workspace ID header
  if (!config.headers["X-Workspace-Id"]) {
    const wsId = getWorkspaceId();
    if (wsId) config.headers["X-Workspace-Id"] = wsId;
  }

  // Serve cached GET response if fresh (fix: actually use the cached adapter)
  if (config.method === "get" && !config._noCache) {
    // Include workspace ID in cache key so switching workspaces gets fresh data
    const wsId = config.headers["X-Workspace-Id"] || getWorkspaceId() || "";
    const cacheKey = wsId + "|" + config.url + JSON.stringify(config.params || {});
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      config._servedFromCache = true; // instant - no real wait, don't show the loading bar for this
      config.adapter = () => Promise.resolve({
        data:       cached.data.data,
        status:     200,
        statusText: "OK (cached)",
        headers:    cached.data.headers,
        config,
        request:    {},
      });
    }
  }

  beginTrackedRequest(config);
  return config;
});

/* ── Response interceptor ────────────────────────────────────── */
client.interceptors.response.use(
  (response) => {
    endTrackedRequest(response.config);

    // Cache successful GET responses
    if (response.config.method === "get" && !response.config._noCache) {
      const wsId2 = response.config.headers["X-Workspace-Id"] || getWorkspaceId() || "";
      const cacheKey = wsId2 + "|" + response.config.url +
        JSON.stringify(response.config.params || {});
      cache.set(cacheKey, { data: response, ts: Date.now() });
    }

    // Any successful WRITE (POST/PUT/PATCH/DELETE) invalidates the whole
    // GET cache. Previously nothing did this automatically — a create/
    // update/delete would succeed, but the very next GET for the same
    // resource (e.g. re-fetching a list right after creating an item in
    // it) could still be served a pre-mutation cached response for up to
    // 30s, making the change look like it "didn't take" until a hard
    // refresh reset the (in-memory, page-scoped) cache. A precise
    // per-resource invalidation would need to know every OTHER cache key
    // a given mutation could affect (e.g. creating a task can also affect
    // dashboard summaries, project task-counts, meeting continuity, etc.)
    // — clearing everything is simpler and correct; the cache is a 30s
    // performance optimization, not something callers should have to
    // reason about for correctness. (_noCache is a GET-only concept —
    // whether a request opted out of being cached has no bearing on
    // whether a write should invalidate what's already cached.)
    if (response.config.method !== "get") {
      cache.clear();
    }
    return response;
  },
  (error) => {
    endTrackedRequest(error.config);

    // 401 — token expired: clear session and redirect to login
    if (error.response?.status === 401) {
      for (const key of Object.keys(sessionStorage)) {
        if (key.endsWith("__token") || key.endsWith("__user") ||
            key.endsWith("__activeWorkspace")) {
          sessionStorage.removeItem(key);
        }
      }
      delete client.defaults.headers.common["Authorization"];
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
    }

    // Auto-retry once on network timeout
    const config = error.config;
    if (!config?._retry && error.code === "ECONNABORTED") {
      config._retry = true;
      return client(config);
    }

    return Promise.reject(error);
  }
);

/* ── Cache helpers ───────────────────────────────────────────── */
export function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    // Match by prefix OR by substring (cache keys are wsId|/path?params)
    if (!prefix || key.startsWith(prefix) || key.includes(prefix)) cache.delete(key);
  }
}

export function clearAllCache() {
  cache.clear();
}

export default client;

/* ── Response shape helpers ──────────────────────────────────── */

/**
 * Extracts a plain array from any API response shape:
 *   - PagedResponse: { data: [], page, totalElements, ... }
 *   - Direct array:  []
 *   - Wrapped:       { data: [] }
 */
export function unwrapList(response) {
  const d = response?.data;
  if (!d) return [];
  if (Array.isArray(d)) return d;              // already an array
  if (Array.isArray(d.data)) return d.data;    // PagedResponse shape
  if (Array.isArray(d.content)) return d.content; // Spring Page shape
  return [];
}

/**
 * Extracts pagination metadata from a PagedResponse.
 */
export function unwrapPaged(response) {
  const d = response?.data;
  if (!d) return { data: [], page: 0, totalPages: 0, totalElements: 0, hasNext: false };
  return {
    data:          Array.isArray(d.data) ? d.data : [],
    page:          d.page          ?? 0,
    totalPages:    d.totalPages    ?? 0,
    totalElements: d.totalElements ?? 0,
    hasNext:       d.hasNext       ?? false,
  };
}
