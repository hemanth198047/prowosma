// Web Push subscription helpers — previously nothing on the frontend
// could actually enable push notifications, even though public/sw.js has
// had a working 'push' event handler (and PWAInstallBanner.jsx has been
// ADVERTISING "🔔 Push Notifications" as a feature) since before this
// change. This is the missing piece that makes that promise real.
import client from "../api/client";

// Converts the VAPID public key (base64url, as returned by the backend)
// into the Uint8Array format PushManager.subscribe() requires — this
// specific conversion is standard boilerplate for every Web Push
// integration (not unique to this app); see MDN's Web Push documentation
// for the same snippet.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Full flow: request Notification permission (if not already granted),
 * fetch the backend's VAPID public key, subscribe via PushManager, and
 * register the subscription with the backend. Returns true only if every
 * step actually succeeded — never a false positive.
 */
export async function enablePushNotifications() {
  if (!(await isPushSupported())) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission-denied" };

  let publicKey;
  try {
    const res = await client.get("/push/vapid-public-key");
    publicKey = res.data.publicKey;
  } catch {
    // Most common cause: this deployment hasn't configured VAPID_PUBLIC_KEY/
    // VAPID_PRIVATE_KEY yet (backend returns 503) — see docs/MOBILE_OFFLINE.md.
    return { ok: false, reason: "not-configured" };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await client.post("/push/subscribe", subscription.toJSON());
  return { ok: true };
}

export async function disablePushNotifications() {
  if (!(await isPushSupported())) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await client.post("/push/unsubscribe", { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
}

/** Sends a real test push to every subscription the current user has — proves the whole pipeline end to end. */
export async function sendTestPush() {
  const res = await client.post("/push/test");
  return res.data.sent; // number of subscriptions actually notified
}

/**
 * Where this browser stands: supported, the permission, whether it's subscribed, and whether the server can send at all.
 * serverReady is false when the server has no VAPID keys (an admin sets them - see the deployment guide).
 */
export async function getPushState() {
  if (!(await isPushSupported())) return { supported: false };
  let serverReady = true;
  try { await client.get("/push/vapid-public-key"); } catch { serverReady = false; }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    subscribed = !!(reg && (await reg.pushManager.getSubscription()));
  } catch { /* no worker yet */ }
  return { supported: true, permission: Notification.permission, subscribed, serverReady };
}

/** After signing in: if this browser already has a subscription, make sure it's linked to the person now signed in. */
export async function relinkPushSubscription() {
  try {
    if (!(await isPushSupported()) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await client.post("/push/subscribe", sub.toJSON());
  } catch { /* best effort */ }
}
