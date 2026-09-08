import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";

export default function LiveClock() {
  const { activeWorkspace } = useAuth();
  const [now, setNow] = useState(new Date());

  // Tick every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timezone   = activeWorkspace?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFormat = activeWorkspace?.dateFormat || "DD/MM/YYYY";

  // Format time — HH:MM:SS AM/PM in workspace timezone
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone:  timezone,
    hour:      "2-digit",
    minute:    "2-digit",
    second:    "2-digit",
    hour12:    true,
  }).formatToParts(now);

  const get = (type) => timeParts.find((p) => p.type === type)?.value || "";
  const hour      = get("hour");
  const minute    = get("minute");
  const second    = get("second");
  const dayPeriod = get("dayPeriod"); // AM / PM

  // Format date in workspace dateFormat
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).formatToParts(now);

  const getD = (type) => dateParts.find((p) => p.type === type)?.value || "";
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = getD("day");
  const m = getD("month");
  const y = getD("year");
  const monthAbbr = MONTHS[parseInt(m, 10) - 1] || m;

  const dateStr = dateFormat
    .replace("MMM", monthAbbr)
    .replace("DD",  d)
    .replace("MM",  m)
    .replace("YYYY", y);

  // Short timezone label
  const tzLabel = new Intl.DateTimeFormat("en-US", {
    timeZone:    timezone,
    timeZoneName: "short",
  }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "";

  // Weekday name
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);

  return (
    <div className="live-clock">
      <div className="live-clock-time">
        <span className="live-clock-hm">{hour}:{minute}</span>
        <span className="live-clock-sec">:{second}</span>
        <span className="live-clock-period">{dayPeriod}</span>
      </div>
      <div className="live-clock-date">
        <span className="live-clock-weekday">{weekday}</span>
        <span>·</span>
        <span>{dateStr}</span>
        {tzLabel && <span className="live-clock-tz">{tzLabel}</span>}
      </div>
    </div>
  );
}
