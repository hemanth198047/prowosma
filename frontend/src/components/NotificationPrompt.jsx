import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { enablePushNotifications, getPushState, relinkPushSubscription } from "../utils/push";
import { requestDesktopPermission, showDesktopNotification } from "../utils/desktopNotify";
import "../styles/desktop-notifications.css";

const KEY = "prowosma.notifPrompt.dismissed";
const read = () => { try { return localStorage.getItem(KEY); } catch { return "1"; } };
const write = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };

/** Once per device: offer desktop notifications. Only when the browser and server can do it and nobody decided yet. */
export default function NotificationPrompt() {
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    relinkPushSubscription();
    if (read()) return undefined;
    getPushState().then((s) => { if (alive && s.supported && s.permission === "default") setShow(true); });   // no server keys needed to offer pop-ups
    return () => { alive = false; };
  }, []);
  if (!show) return null;
  const close = () => { write(); setShow(false); };
  const turnOn = async () => {
    const state = await getPushState().catch(() => ({}));
    if (!state.serverReady) {
      // The server has no push keys: pop-ups still work while Prowosma is open in any window, even a minimised one.
      const p = await requestDesktopPermission();
      if (p === "granted") { showDesktopNotification({ title: "Pop-ups are on", body: "You'll see them here, like a new-mail alert.", tag: "welcome" }); close(); }
      else { setMsg(p === "denied" ? "Blocked by the browser. You can allow it later in Profile → Notifications." : "Couldn't turn them on. Try again from Profile → Notifications."); write(); }
      return;
    }
    const r = await enablePushNotifications().catch(() => ({ ok: false }));
    if (r.ok) close();
    else { setMsg(r.reason === "permission-denied" ? "Blocked by the browser. You can allow it later in Profile → Notifications." : "Couldn't turn them on. Try again from Profile → Notifications."); write(); }
  };
  return (
    <div className="np" role="region" aria-label="Desktop notifications">
      <BellRing size={18} aria-hidden="true" className="np-icon" />
      <p className="np-text">{msg || "Get a pop-up in the corner of your screen for new notifications and clock-in reminders, even when this window is minimised."}</p>
      {!msg && <button type="button" className="btn btn-primary np-btn" onClick={turnOn}>Turn on</button>}
      <button type="button" className="np-x" onClick={close} aria-label="Not now"><X size={16} /></button>
    </div>
  );
}
