// Pop-up notifications on the computer's desktop (bottom-right on Windows, top-right on macOS), like a new-mail pop-up.
// This is the part that needs no server set-up: the browser itself shows the pop-up while Prowosma is open in any tab or window,
// even when that window is minimised or behind others. Closing the browser entirely needs the server's push keys (see the Notifications settings).

export const desktopSupported = () => typeof window !== "undefined" && "Notification" in window;
export const desktopAllowed = () => desktopSupported() && Notification.permission === "granted";

/** Asks the browser for permission. Returns "granted", "denied", "default" or "unsupported". */
export async function requestDesktopPermission() {
  if (!desktopSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** Where a notification should take the person when they click its pop-up. */
export function notificationUrl(n) {
  if (n?.entityType === "TASK" && n.entityId) return `/tasks?highlight=${encodeURIComponent(n.entityId)}`;
  if (n?.entityType === "PROJECT" && n.entityId) return `/tasks?projectId=${encodeURIComponent(n.entityId)}`;
  if (n?.entityType === "GOAL" && n.entityId) return `/goals?highlight=${encodeURIComponent(n.entityId)}`;
  return "/";
}

/** True when the person is not looking at Prowosma right now (another tab, another app, or minimised): the moment a pop-up is useful. */
export const awayFromApp = () => typeof document !== "undefined" && (document.hidden || !document.hasFocus());

/**
 * Shows one pop-up. Resolves true if it was shown. Uses the service worker when there is one (so a click brings Prowosma forward
 * on the right page), else the plain browser notification. Never throws.
 */
export async function showDesktopNotification({ title, body = "", url = "/", tag }) {
  if (!desktopAllowed()) return false;
  const options = { body, icon: "/icons/icon-192.png", badge: "/icons/icon-72.png", tag, renotify: !!tag, data: { url } };
  try {
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, options); return true; }
  } catch { /* fall through to the plain notification */ }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { try { window.focus(); window.location.assign(url); } catch { /* ignore */ } n.close(); };
    return true;
  } catch { return false; }
}
