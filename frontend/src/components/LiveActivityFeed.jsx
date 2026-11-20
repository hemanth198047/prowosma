/**
 * LiveActivityFeed — floating toast-style feed in top-right corner.
 * Shows real-time workspace events as they arrive over WebSocket.
 * Auto-dismisses after 5s. Max 5 toasts visible at once.
 */
import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { Bell as IcBell, ChartColumn as IcChartColumn, CircleCheck as IcCircleCheck, Flag as IcFlag, Folder as IcFolder, MessageSquare as IcMessageSquare, NotebookPen as IcNotebookPen, PartyPopper as IcPartyPopper, Pencil as IcPencil, RefreshCw as IcRefreshCw, Target as IcTarget, Trash2 as IcTrash2, Zap as IcZap } from "lucide-react";

const EVENT_ICON = {
  TASK_CREATED:          <IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_UPDATED:          <IcPencil size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_COMPLETED:        <IcFlag size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_STATUS_CHANGED:   <IcRefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_PRIORITY_CHANGED: <IcZap size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_DELETED:          <IcTrash2 size={16} strokeWidth={1.5} aria-hidden="true" />,
  TASK_COMMENTED:        <IcMessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />,
  PROJECT_CREATED:       <IcFolder size={16} strokeWidth={1.5} aria-hidden="true" />,
  PROJECT_UPDATED:       <IcNotebookPen size={16} strokeWidth={1.5} aria-hidden="true" />,
  PROJECT_DELETED:       <IcTrash2 size={16} strokeWidth={1.5} aria-hidden="true" />,
  GOAL_CREATED:          <IcTarget size={16} strokeWidth={1.5} aria-hidden="true" />,
  GOAL_PROGRESS_CHANGED: <IcChartColumn size={16} strokeWidth={1.5} aria-hidden="true" />,
  GOAL_COMPLETED:        <IcPartyPopper size={16} strokeWidth={1.5} aria-hidden="true" />,
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
        icon:    EVENT_ICON[event.type] || <IcBell size={16} strokeWidth={1.5} aria-hidden="true" />,
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
