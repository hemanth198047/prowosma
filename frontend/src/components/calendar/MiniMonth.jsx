import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

/** Small month picker, like the one in Outlook's left pane. */
export default function MiniMonth({ selected, rangeStart, rangeEnd, busyDays, onPick, firstDay = 0 }) {
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [lastSelected, setLastSelected] = useState(selected);

  // Follow the main calendar when it moves to another month.
  if (!sameDay(selected, lastSelected)) {
    setLastSelected(selected);
    if (selected.getMonth() !== month.getMonth() || selected.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
  }

  const weekdays = useMemo(() => {
    const base = new Date(2023, 0, 1 + firstDay); // 1 Jan 2023 was a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString([], { weekday: "narrow" }));
  }, [firstDay]);

  const days = useMemo(() => {
    const offset = (month.getDay() - firstDay + 7) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month, firstDay]);

  const today = new Date();
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <span className="cal-mini-title">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
        <button type="button" className="cal-icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <button type="button" className="cal-icon-btn" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
      <div className="cal-mini-grid" role="grid" aria-label="Pick a date">
        {weekdays.map((w, i) => <span key={i} className="cal-mini-wd" aria-hidden="true">{w}</span>)}
        {days.map((d) => {
          const inMonth = d.getMonth() === month.getMonth();
          const inRange = rangeStart && rangeEnd && d >= rangeStart && d < rangeEnd;
          const cls = [
            "cal-mini-day",
            inMonth ? "" : "cal-mini-out",
            inRange ? "cal-mini-range" : "",
            sameDay(d, today) ? "cal-mini-today" : "",
            busyDays?.has(d.toDateString()) ? "cal-mini-busy" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={cls}
              onClick={() => onPick(d)}
              aria-label={d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              aria-current={sameDay(d, today) ? "date" : undefined}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
