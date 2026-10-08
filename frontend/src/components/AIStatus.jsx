/**
 * AIStatus — small badge in the top bar, next to the Live pill, saying whether AI is on for the active workspace.
 *   AI On     enabled and ready          AI Off    switched off in AI Settings          AI Setup  switched on but something is missing
 * Everyone sees the state; admins can click it to open AI Settings. It reads /api/ai/status, which never returns the API key.
 * It refreshes every minute, when the window regains focus, when the workspace changes, and right after AI Settings are saved.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAIStatus, AI_SETTINGS_CHANGED } from "../api/ai";
import { useRole } from "../hooks/useRole";
import { useAuth } from "../hooks/useAuth";

const REFRESH_MS = 60_000;
const PROVIDERS = { ANTHROPIC: "Anthropic (Claude)", OPENAI: "OpenAI", GEMINI: "Google Gemini", CUSTOM: "Custom endpoint" };
const META = {
  ON: { label: "AI On", cls: "ai-on" },
  OFF: { label: "AI Off", cls: "ai-off" },
  NEEDS_SETUP: { label: "AI Setup", cls: "ai-setup" },
};

export default function AIStatus() {
  const { isAdmin } = useRole();
  const { activeWorkspace } = useAuth();
  const wsId = activeWorkspace?.id ?? null;
  const [status, setStatus] = useState(null);       // { ws, data } — remembers which workspace it describes

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await getAIStatus();
        if (live) setStatus({ ws: wsId, data: res.data });
      } catch { /* offline or signed out: keep what we last knew */ }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    window.addEventListener(AI_SETTINGS_CHANGED, load);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener(AI_SETTINGS_CHANGED, load);
    };
  }, [wsId]);

  // Show nothing until we know — and never show another workspace's state after switching.
  if (!status || status.ws !== wsId || !status.data) return null;

  const d = status.data;
  const meta = META[d.state] || META.OFF;
  const detail = d.state === "ON" ? `${PROVIDERS[d.provider] || d.provider}${d.model ? ` · ${d.model}` : ""}` : "";
  const title = d.state === "ON"
    ? `AI is on — ${detail}.${isAdmin ? " Click to manage AI Settings." : ""}`
    : `${d.message}${isAdmin ? " Click to open AI Settings." : ""}`;
  const inner = (<><span className="ai-dot" aria-hidden="true" /><span className="ai-label">{meta.label}</span></>);

  return isAdmin ? (
    <Link to="/ai-settings" className={`ai-status ${meta.cls}`} title={title} aria-label={`${meta.label}. ${title}`}>{inner}</Link>
  ) : (
    <div className={`ai-status ${meta.cls}`} role="status" title={title} aria-label={`${meta.label}. ${title}`}>{inner}</div>
  );
}
