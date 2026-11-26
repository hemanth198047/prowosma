import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { enablePushNotifications, disablePushNotifications, sendTestPush, getPushState } from "../utils/push";
import { requestDesktopPermission, showDesktopNotification } from "../utils/desktopNotify";
import "../styles/desktop-notifications.css";

const WHAT = [
  "A task is assigned to you",
  "A task of yours is due within the hour, or becomes overdue",
  "Someone @mentions you in a comment",
  "A message in a private channel or a direct message",
  "You're added to a project",
  "Attendance: it's time to clock in, you haven't clocked in after your start time, or you're still clocked in well after your end",
  "A meeting is about to start",
  "Any new notification in the bell, while Prowosma is open in a window",
];

/** Desktop / phone notifications for this browser: turn on, turn off, send a test - with plain reasons when it can't work. */
export default function PushNotificationToggle({ compact = false }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => setState(await getPushState()), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount
  useEffect(() => { refresh(); }, [refresh]);

  const turnOn = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await enablePushNotifications();
      if (!r.ok) setMsg(r.reason === "permission-denied" ? "Your browser blocked notifications for this site. Allow them in the browser's site settings (the lock icon next to the address), then try again."
        : r.reason === "not-configured" ? "Notifications aren't set up on the server yet. Ask your administrator."
        : "This browser can't show notifications.");
      else setMsg("Done. You'll get notifications on this device, even when Prowosma isn't open.");
    } catch { setMsg("Couldn't turn notifications on. Please try again."); }
    setBusy(false); refresh();
  };
  const turnOff = async () => {
    setBusy(true); setMsg("");
    try { await disablePushNotifications(); setMsg("Turned off on this device."); } catch { setMsg("Couldn't turn them off. Please try again."); }
    setBusy(false); refresh();
  };
  // Works without any server set-up: ask the browser for permission and show a pop-up right now.
  const turnOnHere = async () => {
    setBusy(true); setMsg("");
    const p = await requestDesktopPermission();
    if (p === "granted") {
      await showDesktopNotification({ title: "Prowosma pop-ups are on", body: "This is what a notification looks like. Try minimising the browser.", tag: "pop-up-test" });
      setMsg("Done. A pop-up should have appeared in the corner of your screen.");
    } else setMsg(p === "denied" ? "Your browser blocked notifications for this site. Allow them in the browser's site settings (the lock icon next to the address), then try again." : "No permission was given.");
    setBusy(false); refresh();
  };
  const popUpNow = async () => {
    const ok = await showDesktopNotification({ title: "Test pop-up from Prowosma", body: "If you can read this in the corner of your screen, pop-ups work.", url: "/", tag: "pop-up-test" });
    setMsg(ok ? "Sent. Minimise the browser and press the button again to see it over other windows." : "The browser did not show it. Check your computer's notification / focus-assist settings.");
  };
  const test = async () => {
    setBusy(true); setMsg("");
    try {
      const n = await sendTestPush();
      setMsg(n > 0 ? "Test sent - it should appear in a few seconds." : "Nothing was delivered. Turn notifications off and on again on this device.");
    } catch { setMsg("Couldn't send the test."); }
    setBusy(false);
  };

  if (!state) return <div className="dn"><p className="dn-muted">Checking this browser…</p></div>;

  let status, action = null;
  if (!state.supported) status = { icon: BellOff, text: "This browser can't show notifications. Use Chrome, Edge, Firefox or Safari (on iPhone, add Prowosma to the Home Screen first)." };
  else if (state.permission === "denied") status = { icon: BellOff, text: "Blocked by your browser for this site. Allow notifications in the browser's site settings, then reload." };
  else if (state.subscribed && state.permission === "granted") {
    status = { icon: BellRing, text: "On for this device.", on: true };
    action = <><button type="button" className="btn btn-secondary" onClick={test} disabled={busy}>Send a test</button>
      <button type="button" className="btn btn-secondary" onClick={popUpNow} disabled={busy}>Show a pop-up here</button>
      <button type="button" className="btn btn-secondary" onClick={turnOff} disabled={busy}>Turn off</button></>;
  } else if (state.permission === "granted" && !state.serverReady) {
    status = { icon: BellRing, text: "Pop-ups are on while Prowosma is open in a window (even minimised). To also get them when the browser is closed, ask your administrator to add the server's notification keys.", on: true };
    action = <button type="button" className="btn btn-secondary" onClick={popUpNow} disabled={busy}>Show a test pop-up</button>;
  } else if (!state.serverReady) {
    status = { icon: Bell, text: "Off for this device." };
    action = <button type="button" className="btn btn-primary" onClick={turnOnHere} disabled={busy}>{busy ? "Turning on…" : "Turn on pop-ups"}</button>;
  } else {
    status = { icon: Bell, text: "Off for this device." };
    action = <button type="button" className="btn btn-primary" onClick={turnOn} disabled={busy}>{busy ? "Turning on…" : "Turn on notifications"}</button>;
  }
  const Icon = status.icon;
  return (
    <div className={"dn" + (compact ? " dn--compact" : "")}>
      <div className={"dn-status" + (status.on ? " dn-status--on" : "")}><Icon size={18} aria-hidden="true" /><span>{status.text}</span></div>
      {action && <div className="dn-actions">{action}</div>}
      {msg && <p className="dn-msg" role="status">{msg}</p>}
      {!compact && (
        <>
          <p className="dn-muted">You'll be told when:</p>
          <ul className="dn-list">{WHAT.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="dn-muted">Each device (laptop, phone) is turned on separately.</p>
        </>
      )}
    </div>
  );
}
