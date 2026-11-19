import {
  ArrowRightLeft, CalendarClock, CircleDot, Clock, Flag, MessageSquare, Paperclip, PencilLine, Plus, Trash2, UserRound,
} from "lucide-react";
import { statusText } from "./statusText";

/* The kinds of change people filter by. The server tags each entry; a few old entries are re-tagged here. */
export const KINDS = [
  { key: "STATUS", label: "Status", icon: CircleDot },
  { key: "ASSIGNMENT", label: "Assignment", icon: UserRound },
  { key: "DUE", label: "Due date", icon: CalendarClock },
  { key: "PRIORITY", label: "Priority", icon: Flag },
  { key: "COMMENT", label: "Comments", icon: MessageSquare },
  { key: "FILE", label: "Files", icon: Paperclip },
  { key: "TIME", label: "Time logged", icon: Clock },
  { key: "DETAILS", label: "Title & details", icon: PencilLine },
  { key: "CREATED", label: "Created", icon: Plus },
  { key: "DELETED", label: "Deleted", icon: Trash2 },
  { key: "OTHER", label: "Other", icon: ArrowRightLeft },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k]));

const nice = (v) => (v == null || v === "" ? "nothing" : statusText(v));

/** Old entries written before history was cleaned up: a comment or a file logged as a generic "update". */
export function normalise(e) {
  const nv = e.newValue || "";
  if (e.action === "TASK_UPDATED" && nv === "Comment added") return { ...e, kind: "COMMENT", action: "TASK_COMMENTED", newValue: "" };
  if (e.action === "TASK_UPDATED" && nv.startsWith("Attachment added: ")) return { ...e, kind: "FILE", action: "FILE_ATTACHED", newValue: nv.slice(18) };
  return { ...e, kind: KIND[e.kind] ? e.kind : "OTHER" };
}

/** What happened, in plain words (without the person's name). Returns [sentence, quote?]. */
export function describe(e) {
  const o = e.oldValue, n = e.newValue;
  switch (e.action) {
    case "TASK_CREATED": case "TASK_ADDED": return ["created the task"];
    case "TASK_AUTO_CREATED": return ["created the task from a meeting"];
    case "TASK_STATUS_CHANGED": return [`changed the status from ${nice(o)} to ${nice(n)}`];
    case "TASK_COMPLETED": return ["marked it done"];
    case "TASK_BLOCKED": return [`marked it as waiting on ${String(n || "another task").replace(/^Blocked by: /, "")}`];
    case "TASK_UNBLOCKED": return [`removed the dependency on ${o || "another task"}`];
    case "TASK_ASSIGNED": return [`assigned ${n || "someone"}`];
    case "TASK_UNASSIGNED": return [`took ${o || "someone"} off the task`];
    case "TASK_PRIORITY_CHANGED": return [`changed the priority from ${nice(o)} to ${nice(n)}`];
    case "TASK_DUE_CHANGED": return [!o ? `set the due date to ${n}` : !n ? `removed the due date (was ${o})` : `moved the due date from ${o} to ${n}`];
    case "TASK_RENAMED": return [`renamed it from “${o}” to “${n}”`];
    case "TASK_DESCRIPTION_CHANGED": return ["edited the description"];
    case "TASK_UPDATED": return ["edited the task"];
    case "TASK_COMMENTED": return ["commented", n || null];
    case "FILE_ATTACHED": return [`attached ${n || "a file"}`];
    case "TIME_LOGGED": return [`logged ${n || "time"}`];
    case "TIME_APPROVED": return ["approved the logged time"];
    case "TASK_DELETED": case "TASK_REMOVED": return ["deleted the task"];
    default: return [String(e.action || "changed the task").toLowerCase().replace(/_/g, " ")];
  }
}

