import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { getAttendanceStatus, getMyAttendance } from "../api/attendance";

// ── is the "attendance" flag on? (remembered per user and workspace, like the AI Meeting Assistant's) ──
const flagCache = new Map();
export const ATTENDANCE_FLAG_EVENT = "attendance:flag-changed";

export function useAttendanceEnabled() {
  const auth = useContext(AuthContext);
  const who = auth ? (auth.user?.email || auth.user?.id || "") : "-";
  const ws = auth ? (auth.activeWorkspace?.id || "") : "-";
  const [version, setVersion] = useState(0);
  const key = `${who}|${ws}|${version}`;
  const [answer, setAnswer] = useState({ key: null, enabled: false });

  useEffect(() => {
    const again = () => { flagCache.clear(); setVersion((v) => v + 1); };
    window.addEventListener(ATTENDANCE_FLAG_EVENT, again);
    return () => window.removeEventListener(ATTENDANCE_FLAG_EVENT, again);
  }, []);

  useEffect(() => {
    if (!who || !ws) return undefined;
    let live = true;
    let entry = flagCache.get(key);
    if (!entry) {
      entry = { promise: getAttendanceStatus().then((r) => !!r.data?.enabled).catch(() => null) };
      flagCache.set(key, entry);
    }
    entry.promise.then((v) => {
      if (v === null) flagCache.delete(key);
      if (live) setAnswer({ key, enabled: v === true });
    });
    return () => { live = false; };
  }, [key, who, ws]);

  return answer.key === key && answer.enabled;
}

export function resetAttendanceEnabled() {
  flagCache.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ATTENDANCE_FLAG_EVENT));
}

// ── my clock: one shared copy so the top-bar widget and the Attendance page always agree ──
let current = null;
const listeners = new Set();

export function publishMyAttendance(data) {
  current = data;
  listeners.forEach((fn) => fn(data));
}

export async function refreshMyAttendance() {
  const r = await getMyAttendance();
  publishMyAttendance(r.data);
  return r.data;
}

/** My attendance today ({ state, log, shift, today, rules, ... }); null until loaded. Polls every minute while enabled. */
export function useMyAttendance(enabled = true) {
  const [data, setData] = useState(current);
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(setData);
    refreshMyAttendance().catch(() => {});
    const t = setInterval(() => refreshMyAttendance().catch(() => {}), 60000);
    return () => { listeners.delete(setData); clearInterval(t); };
  }, [enabled]);
  return enabled ? data : null;
}

/** For tests. */
export function resetMyAttendance() { current = null; }

// ── formatting shared by the widget and the page ──
export const MODE_LABEL = { IN_OFFICE: "In office / studio", REMOTE: "Remote / WFH", ON_LOCATION: "On location / shoot" };
export const BREAK_LABEL = { LUNCH: "Lunch", TEA: "Tea / coffee", OTHER: "Break", IDLE: "Away (idle)" };

export function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function hm(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function timeIn(iso, tz) {
  if (!iso) return "—";
  try { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)); }
  catch { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
}

/** Worked time so far today, counting the open session and leaving out breaks (matches the server's arithmetic). */
export function workedMs(log, now = Date.now()) {
  if (!log) return 0;
  let gross = 0;
  for (const s of log.sessions || []) gross += Math.max(0, (s.out ? Date.parse(s.out) : now) - Date.parse(s.in));
  let breaks = 0;
  for (const b of log.breaks || []) breaks += Math.max(0, (b.end ? Date.parse(b.end) : now) - Date.parse(b.start));
  return Math.max(0, gross - breaks);
}

/** The browser's location, if the person allows it within 8 seconds; null otherwise. */
export function currentPosition() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}
