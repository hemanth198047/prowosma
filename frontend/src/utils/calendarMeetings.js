import { parseServerDateTime } from "./serverTime";

/** Default length of a new meeting, like Outlook. */
export const DEFAULT_MEETING_MINS = 30;
/** Hour a new meeting starts at when it is created from a whole day (month view). */
export const DAY_CLICK_START_HOUR = 9;

export const MEETING_TYPES = [
  { value: "OTHER", label: "Meeting" },
  { value: "STANDUP", label: "Stand-up" },
  { value: "REVIEW", label: "Review" },
  { value: "EOD", label: "End of day" },
];

const TYPE_COLORS = {
  STANDUP: "#0f8b8d",
  REVIEW: "#7c5cbf",
  EOD: "#c17d22",
  OTHER: "#5b5fee",
};

export function meetingColor(m) {
  if (m?.status === "CANCELLED") return "#94a3b8";
  return TYPE_COLORS[m?.meetingType] || TYPE_COLORS.OTHER;
}

export function meetingStart(m) {
  return parseServerDateTime(m?.meetingDate);
}

export function meetingEnd(m) {
  const start = meetingStart(m);
  if (!start) return null;
  const mins = m.durationMins > 0 ? m.durationMins : DEFAULT_MEETING_MINS;
  return new Date(start.getTime() + mins * 60000);
}

export function minutesBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

/** A meeting → a FullCalendar event (only meetings can be dragged/resized). */
export function meetingToEvent(m) {
  const start = meetingStart(m);
  if (!start) return null;
  const color = meetingColor(m);
  return {
    id: `meeting-${m.id}`,
    title: m.title || "(No title)",
    start,
    end: meetingEnd(m),
    allDay: false,
    editable: m.status !== "COMPLETED" && m.status !== "CANCELLED",
    backgroundColor: color,
    borderColor: color,
    textColor: "#fff",
    classNames: [
      "cal-ev-meeting",
      m.status === "COMPLETED" ? "cal-ev-done" : "",
      m.status === "CANCELLED" ? "cal-ev-cancelled" : "",
    ].filter(Boolean),
    extendedProps: { type: "meeting", itemId: m.id, meeting: m },
  };
}

/**
 * The slot a double-click or single-click "new" lands on.
 * Time-grid clicks keep their time; whole-day clicks (month view, all-day row)
 * start at 9:00. Both last DEFAULT_MEETING_MINS.
 */
export function slotFromClick(date, allDay) {
  const start = new Date(date);
  if (allDay) start.setHours(DAY_CLICK_START_HOUR, 0, 0, 0);
  return { start, end: new Date(start.getTime() + DEFAULT_MEETING_MINS * 60000) };
}

/** A drag-selected range. All-day ranges become 9:00 on the first day. */
export function slotFromSelection(start, end, allDay) {
  if (allDay) return slotFromClick(start, true);
  return { start: new Date(start), end: new Date(end) };
}

/** The next half hour from now — used by the "New meeting" button. */
export function nextHalfHour(now = new Date()) {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const m = start.getMinutes();
  start.setMinutes(m < 30 ? 30 : 60);
  return { start, end: new Date(start.getTime() + DEFAULT_MEETING_MINS * 60000) };
}

/** Other meetings that overlap [start, end). */
export function findConflicts(start, end, meetings, excludeId) {
  if (!start || !end) return [];
  return (meetings || []).filter((m) => {
    if (m.id === excludeId || m.status === "CANCELLED") return false;
    const s = meetingStart(m);
    const e = meetingEnd(m);
    return s && e && s < end && e > start;
  });
}

export function isLink(text) {
  return /^https?:\/\/\S+$/i.test((text || "").trim());
}

/** The meeting link inside a location such as "Room 3 - https://meet.google.com/abc", or null. Used so a Join button still shows when people typed more than the bare link. */
export function extractLink(text) {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text || "");
  return m ? m[0] : null;
}

/** "HH:mm" options every `step` minutes for the time pickers. */
export function timeOptions(step = 15) {
  const out = [];
  for (let mins = 0; mins < 24 * 60; mins += step) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const label = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    out.push({ value, label });
  }
  return out;
}

export function formatDuration(mins) {
  if (!(mins > 0)) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** "Thu 12 Nov · 10:00 – 10:30" (adds the end date if it differs). */
export function formatRange(start, end) {
  if (!start) return "";
  const day = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (!end) return `${day(start)} · ${time(start)}`;
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day(start)} · ${time(start)} – ${time(end)}`
    : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}

/** Split "a@x.com, Bob; c@y.com" into trimmed, unique attendees. */
export function parseAttendees(text) {
  const seen = new Set();
  return (text || "")
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter((a) => {
      const k = a.toLowerCase();
      if (!a || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** A meeting of the AI Meeting Assistant as a timed calendar block. Read-only here: it is opened in the assistant. */
export function assistantToEvent(m) {
  const start = new Date(m.meetingAt);
  if (Number.isNaN(start.getTime())) return null;
  const endRaw = m.meetingEndAt ? new Date(m.meetingEndAt) : null;
  const end = endRaw && endRaw > start ? endRaw : new Date(start.getTime() + 30 * 60000);
  return {
    id: `uma-${m.id}`, title: m.title || "(No title)", start, end, allDay: false, editable: false,
    backgroundColor: "#0f9d8a", borderColor: "#0f9d8a", textColor: "#fff",
    classNames: ["cal-ev-meeting"],
    extendedProps: { type: "uma", itemId: m.id, item: m },
  };
}

/**
 * One event of the person's Google Calendar, drawn the way Google draws it: at its time (or in the all-day row), and lighter while the
 * person hasn't answered the invitation. umaId is set when the AI Meeting Assistant tracks the same meeting (clicking it opens that page).
 */
export function googleToEvent(g, umaId) {
  if (!g || !g.id) return null;
  const pending = g.myResponse === "needsAction";
  const base = {
    id: `google-${g.id}`, title: g.title || "(No title)", editable: false,
    backgroundColor: pending ? "#e6f6f3" : "#0f9d8a", borderColor: "#0f9d8a", textColor: pending ? "#0b6e61" : "#fff",
    classNames: ["cal-ev-meeting", pending ? "cal-ev-pending" : ""].filter(Boolean),
    extendedProps: { type: "google", itemId: g.id, item: g, umaId: umaId || null },
  };
  if (g.allDay) return g.startDate ? { ...base, start: g.startDate, end: g.endDate || undefined, allDay: true } : null;
  const start = new Date(g.start);
  if (Number.isNaN(start.getTime())) return null;
  const end = g.end ? new Date(g.end) : null;
  return { ...base, start, end: end && end > start ? end : new Date(start.getTime() + 30 * 60000), allDay: false };
}
