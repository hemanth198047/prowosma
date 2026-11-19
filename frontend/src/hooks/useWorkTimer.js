import { useEffect, useState } from "react";
import { getMyWork, startWork, stopWork } from "../api/workSessions";

// One shared copy for the whole app, so the top-bar timer and every project's Start/Stop button agree.
let current = { running: null, todayMinutes: 0, loaded: false };
const listeners = new Set();
let timer = null;

function publish(next) {
  current = { ...current, ...next, loaded: true };
  listeners.forEach((fn) => fn(current));
}

let retry = null;
export async function refreshWork() {
  try {
    const r = await getMyWork();
    publish({ running: r.data?.running || null, todayMinutes: r.data?.todayMinutes || 0 });
  } catch {
    // Right after sign-in the workspace may not be chosen yet: try again shortly rather than in a minute.
    if (!retry && listeners.size) retry = setTimeout(() => { retry = null; refreshWork(); }, 4000);
  }
  return current;
}

/** Start working on a project (stops whatever was running). Throws the server's error. */
export async function startOn(projectId) {
  const r = await startWork(projectId);
  publish({ running: r.data });
  refreshWork();
  return r.data;
}

export async function stopNow() {
  const r = await stopWork();
  publish({ running: null, todayMinutes: r.data?.todayMinutes ?? current.todayMinutes });
  return r.data?.stopped || null;
}

/** { running, todayMinutes, loaded } - refreshed every minute while anything shows it. */
export function useWorkTimer() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      refreshWork();
      timer = setInterval(refreshWork, 60000);
    }
    return () => {
      listeners.delete(setState);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  return state;
}

/** Ticks once a second while `on` (for the running clock). */
export function useNow(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function elapsed(fromIso, now) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function hoursText(minutes) {
  const m = Math.round(minutes || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
