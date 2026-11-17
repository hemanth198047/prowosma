import { useContext, useEffect, useState } from "react";
import { AuthContext } from "../context/AuthContext";
import { getUmaStatus } from "../api/aiMeetingAssistant";

// The answer depends on WHO is signed in and WHICH workspace is open, so it is remembered per (user, workspace) and asked again
// whenever either changes - signing out and in, or switching workspace, needs no page refresh. A failed check is never remembered
// (e.g. one made in the moment before the workspace was chosen), so the next render asks again.
const cache = new Map();          // key -> { promise }
export const FLAG_CHANGED_EVENT = "uma:flag-changed";

/** Whether the "universalMeetingAssistant" flag is on for the current workspace. false while unknown or on any error. */
export function useAiMeetingAssistantEnabled() {
  const auth = useContext(AuthContext);                       // null outside the app's provider (tests): just ask
  const who = auth ? (auth.user?.email || auth.user?.id || "") : "-";
  const ws = auth ? (auth.activeWorkspace?.id || "") : "-";
  const [version, setVersion] = useState(0);
  const key = `${who}|${ws}|${version}`;
  const [answer, setAnswer] = useState({ key: null, enabled: false });

  useEffect(() => {
    const again = () => { cache.clear(); setVersion((v) => v + 1); };
    window.addEventListener(FLAG_CHANGED_EVENT, again);
    return () => window.removeEventListener(FLAG_CHANGED_EVENT, again);
  }, []);

  useEffect(() => {
    if (!who || !ws) return undefined;                          // not signed in, or no workspace chosen yet
    let live = true;
    let entry = cache.get(key);
    if (!entry) {
      entry = { promise: getUmaStatus().then((r) => !!r.data?.enabled).catch(() => null) };
      cache.set(key, entry);
    }
    entry.promise.then((v) => {
      if (v === null) cache.delete(key);                        // don't remember a failure
      if (live) setAnswer({ key, enabled: v === true });
    });
    return () => { live = false; };
  }, [key, who, ws]);

  return answer.key === key && answer.enabled;
}

/** Forget every answer and ask again (after an admin changes the flag, or in tests). */
export function resetAiMeetingAssistantEnabled() {
  cache.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FLAG_CHANGED_EVENT));
}
