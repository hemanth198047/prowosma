/**
 * LiveActivityFeed — floating toast-style feed in top-right corner.
 * Shows real-time workspace events as they arrive over WebSocket.
 * Auto-dismisses after 5s. Max 5 toasts visible at once.
 */
import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const EVENT_ICON = {
  TASK_CREATED:          "✅",
  TASK_UPDATED:          "✏️",
  TASK_COMPLETED:        "🏁",
  TASK_STATUS_CHANGED:   "🔄",
  TASK_PRIORITY_CHANGED: "⚡",
  TASK_DELETED:          "🗑️",
  TASK_COMMENTED:        "💬",
  PROJECT_CREATED:       "📁",
  PROJECT_UPDATED:       "📝",
  PROJECT_DELETED:       "🗑️",
  GOAL_CREATED:          "🎯",
  GOAL_PROGRESS_CHANGED: "📊",
  GOAL_COMPLETED:        "🎉",
};

const EVENT_COLOR = {
  TASK_COMPLETED:  "#10b981",
  GOAL_COMPLETED:  "#10b981",
  TASK_DELETED:    "#ef4444",
  PROJECT_DELETED: "#ef4444",
  TASK_CREATED:    "#6366f1",
  PROJECT_CREATED: "#6366f1",
  GOAL_CREATED:    "#6366f1",
};

let toastId = 0;

export default function LiveActivityFeed() {
  const { subscribe } = useWebSocket();
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  useEffect(() => {
    const unsub = subscribe(null, (event) => {
      const id = ++toastId;
      const toast = {
        id,
        type:    event.type,
        message: event.message,
        entity:  event.entityName,
        icon:    EVENT_ICON[event.type] || "🔔",
        color:   EVENT_COLOR[event.type] || "#0ea5e9",
        leaving: false,
      };
      setToasts(prev => [...prev.slice(-4), toast]); // max 5
      // Auto-dismiss after 5s
      setTimeout(() => dismiss(id), 5000);
    });
    return unsub;
  }, [subscribe, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="live-feed-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`live-feed-toast ${t.leaving ? "leaving" : "entering"}`}
          style={{ borderLeftColor: t.color }}
        >
          <span className="live-feed-icon">{t.icon}</span>
          <div className="live-feed-body">
            <div className="live-feed-message">{t.message}</div>
          </div>
          <button className="live-feed-close" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
