import { Ban as IcBan, CalendarDays as IcCalendarDays, CircleCheck as IcCircleCheck, DoorOpen as IcDoorOpen, FileText as IcFileText, Headphones as IcHeadphones, Hourglass as IcHourglass, Mic as IcMic, NotebookPen as IcNotebookPen, Plug as IcPlug, RefreshCw as IcRefreshCw, Settings as IcSettings, TriangleAlert as IcTriangleAlert } from "lucide-react";
import { createElement as h_ } from "react";
// Display metadata for meeting-assistant sessions. The status names mirror the backend's
// SessionStatus enum; the wording is deliberately plain.
export const STATUS_META = {
  SCHEDULED:             { label: "Scheduled",             tone: "info",     icon: h_(IcCalendarDays, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  AWAITING_TRANSCRIPT:   { label: "Waiting for transcript", tone: "info",     icon: h_(IcHourglass, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  TRANSCRIPT_RECEIVED:   { label: "Transcript received", tone: "success",  icon: h_(IcFileText, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  CONNECTING:            { label: "Connecting",            tone: "progress", icon: h_(IcPlug, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  WAITING_FOR_ADMISSION: { label: "Waiting for admission", tone: "progress", icon: h_(IcDoorOpen, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  LISTENING:             { label: "Listening",             tone: "progress", icon: h_(IcHeadphones, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  RECONNECTING:          { label: "Reconnecting",          tone: "progress", icon: h_(IcRefreshCw, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  PROCESSING:            { label: "Processing",            tone: "progress", icon: h_(IcSettings, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  READY_FOR_REVIEW:      { label: "Ready for review",      tone: "success",  icon: h_(IcNotebookPen, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  COMPLETED:             { label: "Completed",             tone: "success",  icon: h_(IcCircleCheck, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  FAILED:                { label: "Failed",                tone: "danger",   icon: h_(IcTriangleAlert, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  CANCELLED:             { label: "Cancelled",             tone: "neutral",  icon: h_(IcBan, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
};

export const ALL_STATUSES = Object.keys(STATUS_META);

export const PROVIDER_META = {
  GOOGLE_MEET: { name: "Google Meet",     icon: h_("span", { className: "emo-dot emo-dot--green", "aria-hidden": true }) },
  MS_TEAMS:    { name: "Microsoft Teams", icon: h_("span", { className: "emo-dot emo-dot--violet", "aria-hidden": true }) },
  RECORDING:   { name: "Recording",       icon: h_(IcMic, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  FIREFLIES:   { name: "Fireflies",       icon: h_(IcNotebookPen, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
  UPLOAD:      { name: "Uploaded transcript", icon: h_(IcFileText, { size: 16, strokeWidth: 1.5, "aria-hidden": true }) },
};

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export const statusMeta = (s) => STATUS_META[s] || { label: s || "Unknown", tone: "neutral", icon: "•" };
export const isActiveStatus = (s) => !TERMINAL.has(s);
export const providerName = (p) => PROVIDER_META[p]?.name || p || "Unknown platform";

/** Cancel is offered for any non-terminal session the person may manage; retry only after failure. */
export const canCancelSession = (s) => !!s?.canManage && isActiveStatus(s.status) && s.status !== "READY_FOR_REVIEW";
export const canRetrySession  = (s) => !!s?.canManage && s.status === "FAILED";

/**
 * The button never promises live attendance the server can't deliver: it says
 * "Send Meeting Assistant" only when at least one platform reports a live-join capability.
 */
export function submitLabel(capabilities) {
  return capabilities?.platforms?.some((p) => p.liveJoin) ? "Send Meeting Assistant" : "Register meeting";
}

/** Local datetime-local string for "now + minutes" (used as the schedule input's minimum). */
export function localInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Statuses in which a transcript may be added or replaced (mirrors the server's rule). */
export const ACCEPTS_TRANSCRIPT = ["SCHEDULED", "AWAITING_TRANSCRIPT", "TRANSCRIPT_RECEIVED", "FAILED", "READY_FOR_REVIEW"];
export const WAITING_FOR_TRANSCRIPT = ["SCHEDULED", "AWAITING_TRANSCRIPT"];

/** 83000 -> "01:23"; 3723000 -> "1:02:03". Null/undefined -> "". */
export function formatClock(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return "";
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const MAX_UPLOAD_BYTES = 5_000_000;
