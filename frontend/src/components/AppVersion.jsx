import { useEffect, useRef, useState } from "react";
import { currentVersion, fetchLiveVersion, freshReload } from "../utils/staleApp";

/* global __APP_RELEASE__, __APP_BUILT_AT__ */
const number = () => (typeof __APP_RELEASE__ === "string" && __APP_RELEASE__ ? __APP_RELEASE__ : "");
const builtAt = () => (typeof __APP_BUILT_AT__ === "string" ? __APP_BUILT_AT__ : "");

/** "26 Nov 2026, 7:55 pm" in the reader's own time zone, or "" when the build time is unknown. */
export function formatBuilt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The version of Prowosma this page is running, as a plain number next to the name ("v1.340"). A higher number is a newer version, so after
 * a deploy anyone can tell whether their page already has it. Click it to check the server: it says "Up to date" for a moment, or turns
 * into "Update" when a newer version is live (click again to load it).
 */
export default function AppVersion() {
  const [state, setState] = useState("idle"); // idle | checking | current | stale | unknown
  const timer = useRef(null);
  const mine = currentVersion();
  const when = formatBuilt(builtAt());
  const label = mine === "dev" ? "dev" : `v${number() || "1.0"}`;
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next) => { setState(next); clearTimeout(timer.current); if (next !== "stale") timer.current = setTimeout(() => setState("idle"), 3500); };
  const check = async () => {
    if (state === "stale") { freshReload(); return; }
    if (state === "checking") return;
    setState("checking");
    const live = await fetchLiveVersion();
    settle(!live ? "unknown" : live === mine ? "current" : "stale");
  };

  const text = { idle: label, checking: "Checking…", current: "Up to date ✓", stale: "Update ↻", unknown: "Offline?" }[state];
  const hint = {
    idle: `Prowosma ${label}${when ? ` · updated ${when}` : ""}. Click to check for a newer version.`,
    checking: "Checking for a newer version…",
    current: "You are using the latest version.",
    stale: "A newer version is ready. Click to load it.",
    unknown: "Could not reach the server to check. Click to try again.",
  }[state];

  return (
    <button type="button" className={`app-version app-version-${state}`} onClick={check} title={hint} aria-label={hint}>
      {text}
    </button>
  );
}
