import { useEffect, useState } from "react";
import { getUmaStatus } from "../api/aiMeetingAssistant";

// One request per page load, shared by the sidebar and the page. The status endpoint never fails for a disabled feature.
let entry = null;

/** Whether the "universalMeetingAssistant" flag is on for the current workspace. false while unknown or on any error. */
export function useAiMeetingAssistantEnabled() {
  const [enabled, setEnabled] = useState(entry?.value ?? false);
  useEffect(() => {
    let live = true;
    if (!entry) {
      const e = { value: undefined };
      e.promise = getUmaStatus().then(r => !!r.data?.enabled).catch(() => false).then(v => (e.value = v));
      entry = e;
    }
    entry.promise.then(v => { if (live) setEnabled(v); });
    return () => { live = false; };
  }, []);
  return enabled;
}

/** Forget the answer (after an admin changes the flag, or in tests). */
export function resetAiMeetingAssistantEnabled() { entry = null; }
