/**
 * A page opened before a deploy keeps asking for files of the OLD build. Once the old files are gone, "open Meetings" fails with
 * "Failed to fetch dynamically imported module" and the whole app shows "Something went wrong". Nobody should have to clear their cache for that:
 * we notice it (a failed chunk, or /version.json saying a newer build is live) and reload onto the new build by ourselves.
 */
/* global __APP_VERSION__ */

const CHUNK_ERROR = /dynamically imported module|importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed/i;
const RELOAD_KEY = "prowosma.staleReloadAt";

export const currentVersion = () => (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev");

/** True for the errors a browser raises when a lazily loaded file of an older build no longer exists. */
export function isChunkLoadError(err) {
  const text = typeof err === "string" ? err : `${err?.name || ""} ${err?.message || ""}`;
  return CHUNK_ERROR.test(text);
}

/** Reloads the page, but at most once every 30 seconds, so a real outage can never turn into a reload loop. Returns whether it reloaded. */
export function reloadOnce(now = Date.now()) {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (now - last < 30000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch { /* storage blocked: reload anyway, once, below */ }
  window.location.reload();
  return true;
}

/** Throws away the offline caches of the old build, so the reload really fetches the new one. */
export async function freshReload() {
  try { if (typeof caches !== "undefined") await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch { /* best effort */ }
  try { const reg = await navigator.serviceWorker?.getRegistration?.(); await reg?.update?.(); } catch { /* best effort */ }
  window.location.reload();
}

/** The build id that is live on the server right now, or null when it can't be read (offline, or no /version.json). */
export async function fetchLiveVersion() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    const v = (await res.json())?.version;
    return typeof v === "string" && v ? v : null;
  } catch { return null; }
}

/** Reload by itself when a lazily loaded file of the old build is gone. Call once at start-up. */
export function installStaleAppGuards() {
  window.addEventListener("vite:preloadError", (e) => { e.preventDefault?.(); reloadOnce(); });
  window.addEventListener("unhandledrejection", (e) => { if (isChunkLoadError(e.reason)) { e.preventDefault?.(); reloadOnce(); } });
}
