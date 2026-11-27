/**
 * Tells the server when something breaks in a person's browser, so a crash is never invisible again (it shows up in the server log as
 * "[client-error]"). Quiet by design: it never throws, sends at most a few reports per page load, and never repeats the same one.
 */
import { currentVersion, isChunkLoadError } from "./staleApp";
import { getToken } from "../api/client";

const API = (import.meta.env.VITE_API_URL || "http://localhost:9090") + "/api";
const MAX_PER_PAGE = 5;
const seen = new Set();
let sent = 0;

export function describeError(err) {
  if (!err) return { message: "Unknown error", stack: "" };
  if (typeof err === "string") return { message: err, stack: "" };
  return { message: String(err.message || err.name || err), stack: String(err.stack || "") };
}

/** Reports one problem. `source` says where it was caught ("page", "app", "window", "promise"). Returns whether it was sent. */
export function reportClientError(err, source = "app", extra = {}) {
  try {
    if (isChunkLoadError(err)) return false;               // an old page asking for a file of an old build: it reloads itself, not a bug
    const { message, stack } = describeError(err);
    const key = `${source}|${message}|${stack.split("\n")[1] || ""}`;
    if (seen.has(key) || sent >= MAX_PER_PAGE) return false;
    seen.add(key); sent += 1;
    const body = JSON.stringify({
      message: message.slice(0, 500), stack: stack.slice(0, 2000), source,
      page: window.location.pathname, version: currentVersion(), userAgent: navigator.userAgent.slice(0, 200), ...extra,
    });
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${API}/auth/client-errors`, { method: "POST", headers, body, keepalive: true }).catch(() => {});
    return true;
  } catch { return false; }
}

/** Catches what no component catches: a script error, or a promise that failed and nobody was waiting for. Call once at start-up. */
export function installErrorReporting() {
  window.addEventListener("error", (e) => reportClientError(e.error || e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason, "promise"));
}

/** Test helper: forget what was reported. */
export function resetReportedErrors() { seen.clear(); sent = 0; }
