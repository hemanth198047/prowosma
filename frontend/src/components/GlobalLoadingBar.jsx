import { useSyncExternalStore, useEffect, useState } from "react";
import { subscribeToLoading, getActiveRequestCount } from "../api/client";

/**
 * GlobalLoadingBar — a thin, animated bar fixed to the very top of the
 * viewport that appears automatically whenever ANY background request is
 * in flight (save, send, delete, page load, checkout redirect, test email,
 * etc.) and disappears the instant nothing is pending.
 *
 * This is deliberately NOT something individual pages have to opt into —
 * it subscribes directly to the shared request counter in api/client.js,
 * so it covers every API call in the app automatically, including ones
 * added after this component was written. Local "Saving…" button states
 * are still worth adding for the highest-traffic actions (better,
 * closer-to-the-click feedback), but this is the safety net underneath
 * all of them so nothing can go through silently.
 *
 * Shows only after a short delay (180ms) so fast, near-instant requests
 * don't cause an annoying flicker — anything actually worth telling the
 * user about will comfortably clear that bar.
 */
export default function GlobalLoadingBar() {
  const activeCount = useSyncExternalStore(subscribeToLoading, getActiveRequestCount);
  const isLoading = activeCount > 0;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- debounced visibility: hides immediately, shows only after a delay via the timer below
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 9999,
        overflow: "hidden",
        background: "rgba(99, 102, 241, 0.12)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "40%",
          background: "linear-gradient(90deg, #0ea5e9, #6366f1)",
          borderRadius: 2,
          animation: "globalLoadingBarSlide 1.1s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes globalLoadingBarSlide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(80%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}
