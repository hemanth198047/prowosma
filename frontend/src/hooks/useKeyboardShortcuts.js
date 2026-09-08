/**
 * useKeyboardShortcuts — global keyboard shortcut handler.
 *
 * Shortcuts:
 *   Cmd/Ctrl+K     — open command palette
 *   Escape         — close modals
 *   G then T       — go to Tasks
 *   G then P       — go to Projects
 *   G then G       — go to Goals
 *   G then D       — go to Dashboard
 *   G then K       — go to Kanban
 *   G then A       — go to Analytics
 *   ?              — show shortcuts help
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export function useKeyboardShortcuts({ onCommandPalette, onNewTask }) {
  const navigate   = useNavigate();
  const lastKey    = useRef(null);
  const lastKeyTime = useRef(0);

  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName;
      // Don't fire inside inputs/textareas
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;

      // Cmd+K / Ctrl+K — command palette (always fires, even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onCommandPalette?.();
        return;
      }

      if (inInput) return;

      const now = Date.now();
      const prev = lastKey.current;
      const prevTime = lastKeyTime.current;

      // Two-key chord: G + letter (within 600ms)
      if (e.key !== "g" && prev === "g" && now - prevTime < 600) {
        const routes = { t:"/tasks", p:"/projects", g:"/goals", d:"/", k:"/kanban",
                         a:"/analytics", r:"/reports", c:"/calendar", n:"/gantt",
                         l:"/activity", m:"/team" };
        if (routes[e.key]) { e.preventDefault(); navigate(routes[e.key]); lastKey.current = null; return; }
      }

      lastKey.current  = e.key;
      lastKeyTime.current = now;

      // Single-key shortcuts
      switch (e.key) {
        case "n": onNewTask?.();   break;
        case "?": showHelp();      break;
        default: break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, onCommandPalette, onNewTask]);
}

function showHelp() {
  // Dispatch custom event to show help modal
  window.dispatchEvent(new CustomEvent("prowosma:show-shortcuts"));
}
