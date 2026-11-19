import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { enablePushNotifications, disablePushNotifications, sendTestPush, getPushState } from "../utils/push";
import "../styles/desktop-notifications.css";

const WHAT = [
  "A task is assigned to you",
  "A task of yours is due within the hour, or becomes overdue",
  "Someone @mentions you in a comment",
  "A message in a private channel or a direct message",
  "You're added to a project",
  "Attendance: you haven't clocked in after your start time, or you're still clocked in well after your end",
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
  else if (!state.serverReady) status = { icon: BellOff, text: "Notifications aren't set up on the server yet. Ask your administrator to add the notification keys." };
  else if (state.permission === "denied") status = { icon: BellOff, text: "Blocked by your browser for this site. Allow notifications in the browser's site settings, then reload." };
  else if (state.subscribed && state.permission === "granted") {
    status = { icon: BellRing, text: "On for this device.", on: true };
    action = <><button type="button" className="btn btn-secondary" onClick={test} disabled={busy}>Send a test</button>
      <button type="button" className="btn btn-secondary" onClick={turnOff} disabled={busy}>Turn off</button></>;
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
