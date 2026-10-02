import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Same backend the web app talks to — this is the "connected at the end
// of the day" requirement: separate app, separate deployment, same data.
export const API_BASE_URL = 'https://prowosma.onrender.com/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
});

// ── Token / workspace persistence ──────────────────────────────
// AsyncStorage is the React Native equivalent of localStorage — there's
// no multi-tab concept on a phone, so we don't need the web app's
// tab-scoped sessionStorage split, just a single persisted session.
const TOKEN_KEY = 'prowosma_token';
const USER_KEY = 'prowosma_user';
const WORKSPACE_KEY = 'prowosma_active_workspace';

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function getStoredUser() {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setStoredUser(user) {
  if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  else await AsyncStorage.removeItem(USER_KEY);
}

export async function getActiveWorkspace() {
  const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setActiveWorkspace(workspace) {
  if (workspace) await AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  else await AsyncStorage.removeItem(WORKSPACE_KEY);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, WORKSPACE_KEY]);
}

// ── Request interceptor — attach JWT + X-Workspace-Id ──────────
// Mirrors the web app's client.js exactly: every request automatically
// carries the bearer token and the active workspace id, so screen code
// never has to think about auth headers.
client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers['Authorization'] = `Bearer ${token}`;

  const workspace = await getActiveWorkspace();
  if (workspace?.id) config.headers['X-Workspace-Id'] = workspace.id;

  return config;
});

// ── Response interceptor — session expiry ──────────────────────
// A 401 anywhere means the token is gone/expired/revoked. There's no
// window.location on a phone, so instead of a hard redirect we clear the
// stored session and let a listener (see AuthContext) react to it and
// route back to the Login screen the React Navigation way.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await clearSession();
      if (onUnauthorized) onUnauthorized();
    }
    return Promise.reject(error);
  }
);

/**
 * Extracts a plain array from any API response shape — same three shapes
 * the web app's unwrapList() handles (PagedResponse, direct array,
 * Spring Page). Kept identical on purpose: both apps hit the same
 * endpoints and must agree on how to read the results.
 */
export function unwrapList(response) {
  const d = response?.data;
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d.content)) return d.content;
  return [];
}

export default client;
