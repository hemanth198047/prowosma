import { useEffect, useState } from "react";
import { currentVersion, fetchLiveVersion, freshReload } from "../utils/staleApp";

const EVERY_MS = 5 * 60 * 1000;

/**
 * "A new version is ready." Shown when the server has a newer build than the one this page is running (checked every 5 minutes and whenever the
 * tab comes back to the front). One click reloads onto the new build, with the old offline caches cleared.
 */
export default function UpdateBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = currentVersion();
    if (mine === "dev") return undefined;
    let alive = true;
    const check = async () => {
      const live = await fetchLiveVersion();
      if (alive && live && live !== mine) setStale(true);
    };
    const first = setTimeout(check, 20000);
    const timer = setInterval(check, EVERY_MS);
    const onShow = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, []);

  if (!stale) return null;
  return (
    <div role="status" aria-live="polite" style={{
      position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)", zIndex: 5000, maxWidth: "calc(100vw - 24px)",
      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12,
      background: "#1e1b4b", color: "#fff", boxShadow: "0 8px 28px rgba(0,0,0,.3)", fontSize: 14,
    }}>
      <span>A new version of Prowosma is ready.</span>
      <button type="button" onClick={freshReload}
        style={{ border: 0, borderRadius: 8, padding: "7px 14px", background: "#fff", color: "#1e1b4b", fontWeight: 700, cursor: "pointer" }}>
        Refresh
      </button>
    </div>
  );
}
