/** Pure helpers for the scheduling assistant. Dates are JS Dates; busy blocks are [start, end). */

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

/** API rows → Map(lower-cased email → [{start, end}]) */
export function parseAvailability(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r?.email) continue;
    const busy = (r.busy || [])
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
      .filter((b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()) && b.end > b.start);
    out.set(r.email.toLowerCase(), { ...r, busy });
  }
  return out;
}

export function overlaps(blocks, start, end) {
  return (blocks || []).some((b) => b.start < end && b.end > start);
}

/** "free" | "busy" | "unknown" for one person over [start, end). */
export function statusFor(info, start, end) {
  if (!info) return "unknown";
  return overlaps(info.busy, start, end) ? "busy" : "free";
}

/** Minutes the zone is ahead of UTC at `date` (e.g. +330 for Asia/Kolkata). null if unknown. */
export function tzOffsetMinutes(timeZone, date) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/**
 * The person's working hours (9–18 in their own time zone) on the calendar day that starts at
 * `dayStart` in the viewer's zone, as viewer-local Dates. Falls back to the viewer's 9–18.
 */
export function workingWindow(timeZone, dayStart) {
  const viewerStart = new Date(dayStart);
  viewerStart.setHours(WORK_START_HOUR, 0, 0, 0);
  const viewerEnd = new Date(dayStart);
  viewerEnd.setHours(WORK_END_HOUR, 0, 0, 0);
  const theirs = tzOffsetMinutes(timeZone, viewerStart);
  if (theirs === null) return { start: viewerStart, end: viewerEnd, own: true };
  const mine = -viewerStart.getTimezoneOffset();
  const shift = (mine - theirs) * 60000; // same wall-clock hour, their zone
  return { start: new Date(viewerStart.getTime() + shift), end: new Date(viewerEnd.getTime() + shift), own: theirs === mine };
}

/**
 * Up to `limit` start times on the day where everyone is free for `durationMins`, inside the
 * viewer's working hours, on a `step`-minute grid, not in the past. Closest to `prefer` first.
 */
export function suggestTimes({ availability, emails, dayStart, durationMins, prefer, now = new Date(), step = 30, limit = 4 }) {
  const out = [];
  const from = new Date(dayStart); from.setHours(WORK_START_HOUR, 0, 0, 0);
  const until = new Date(dayStart); until.setHours(WORK_END_HOUR, 0, 0, 0);
  const people = (emails || []).map((e) => availability.get(e.toLowerCase())).filter(Boolean);
  for (let t = from.getTime(); t + durationMins * 60000 <= until.getTime(); t += step * 60000) {
    const s = new Date(t);
    const e = new Date(t + durationMins * 60000);
    if (s < now) continue;
    if (people.every((p) => !overlaps(p.busy, s, e))) out.push(s);
  }
  if (prefer) out.sort((a, b) => Math.abs(a - prefer) - Math.abs(b - prefer));
  return out.slice(0, limit).sort((a, b) => a - b);
}

/** Merge everyone's busy blocks into one list (for the "All attendees" row). */
export function combineBusy(infos) {
  const all = infos.flatMap((i) => i?.busy || []).sort((a, b) => a.start - b.start);
  const out = [];
  for (const b of all) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) { if (b.end > last.end) last.end = new Date(b.end); }
    else out.push({ start: new Date(b.start), end: new Date(b.end) });
  }
  return out;
}
