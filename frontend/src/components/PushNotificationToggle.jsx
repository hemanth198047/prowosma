import { useState } from "react";
import { enablePushNotifications, sendTestPush } from "../utils/push";

/**
 * Real, working push-notification enrollment — previously
 * PWAInstallBanner.jsx advertised "Push Notifications" as a feature
 * with no way to actually turn it on. Small and self-contained so it can
 * be dropped into the install banner (see below) or a settings page.
 */
export default function PushNotificationToggle() {
  const [status, setStatus] = useState("idle"); // idle | enabling | enabled | error
  const [errorReason, setErrorReason] = useState(null);
  const [testSent, setTestSent] = useState(null);

  const handleEnable = async () => {
    setStatus("enabling");
    const result = await enablePushNotifications();
    if (result.ok) {
      setStatus("enabled");
    } else {
      setStatus("error");
      setErrorReason(result.reason);
    }
  };

  const handleTest = async () => {
    const sent = await sendTestPush();
    setTestSent(sent);
  };

  if (status === "enabled") {
    return (
      <div style={{ fontSize: "13px" }}>
        <span style={{ color: "#10b981" }}>✓ Push notifications enabled</span>
        <button className="btn-secondary" style={{ marginLeft: "8px", fontSize: "12px" }} onClick={handleTest}>
          Send test
        </button>
        {testSent !== null && (
          <div style={{ marginTop: "4px", color: "#666" }}>
            {testSent > 0 ? `Sent to ${testSent} device(s) ✓` : "No devices received it — check backend VAPID config"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ fontSize: "13px" }}>
      <button className="btn-secondary" onClick={handleEnable} disabled={status === "enabling"}>
        {status === "enabling" ? "Enabling…" : "Enable Push Notifications"}
      </button>
      {status === "error" && (
        <div style={{ marginTop: "4px", color: "#ef4444" }}>
          {errorReason === "not-configured" && "Push notifications aren't configured on this server yet."}
          {errorReason === "permission-denied" && "Notification permission was denied — enable it in your browser settings."}
          {errorReason === "unsupported" && "Your browser doesn't support push notifications."}
        </div>
      )}
    </div>
  );
}
