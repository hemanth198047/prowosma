import { useEffect } from "react";
import { freshReload, isChunkLoadError, reloadOnce } from "../utils/staleApp";

// Kept plain on purpose — this only renders when something has already gone wrong at the React
// render level, so it must not depend on application code that could itself fail.
export function ErrorFallback({ error }) {
  // A page opened before a deploy asking for a file of the old build: reload onto the new build by itself.
  const outdated = isChunkLoadError(error);
  useEffect(() => { if (outdated) reloadOnce(); }, [outdated]);

  return (
    <div style={{ padding: "40px", fontFamily: "sans-serif", textAlign: "center" }}>
      <h2>{outdated ? "Prowosma was updated." : "Something went wrong."}</h2>
      <p style={{ color: "#666" }}>
        {outdated ? "Loading the new version…" : "The error has been reported automatically. Try reloading the page."}
      </p>
      <button type="button" onClick={freshReload}
        style={{ marginTop: 12, padding: "10px 18px", border: 0, borderRadius: 8, background: "#4f46e5", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
        Reload
      </button>
      {import.meta.env.DEV && (
        <pre style={{ textAlign: "left", background: "#f5f5f5", padding: "12px", marginTop: "16px", overflow: "auto" }}>
          {String(error)}
        </pre>
      )}
    </div>
  )
}
