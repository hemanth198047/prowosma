import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { combineBusy, statusFor, suggestTimes, workingWindow, tzOffsetMinutes } from "../../utils/availability";
import { initials } from "../../utils/org";

const HOUR_PX = 56;
const DAY_MS = 24 * 3600 * 1000;

const pct = (d, dayStart) => ((d - dayStart) / DAY_MS) * 100;
const fmt = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Track({ blocks, dayStart, work, unknown, onPick, label }) {
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.999);
    const mins = Math.floor((ratio * 24 * 60) / 30) * 30;
    onPick(new Date(dayStart.getTime() + mins * 60000));
  };
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  return (
    // Mouse shortcut; the suggestions and the time pickers are the keyboard path.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={`sa-track${unknown ? " sa-unknown" : ""}`} onClick={pick} title={label}>
      {work && work.start > dayStart && (
        <span className="sa-off" style={{ left: 0, width: `${pct(work.start, dayStart)}%` }} />
      )}
      {work && work.end < dayEnd && (
        <span className="sa-off" style={{ left: `${pct(work.end, dayStart)}%`, right: 0 }} />
      )}
      {(blocks || []).map((b, i) => (
        <span
          key={i}
          className="sa-busy"
          style={{ left: `${Math.max(0, pct(b.start, dayStart))}%`, width: `${Math.max(0.4, pct(b.end, dayStart) - Math.max(0, pct(b.start, dayStart)))}%` }}
          title={`Busy ${fmt(b.start)} – ${fmt(b.end)}`}
        />
      ))}
    </div>
  );
}

/**
 * Outlook-style scheduling assistant: one row per person showing when they're busy on the
 * meeting's day, their working hours, the proposed meeting, and times when everyone is free.
 */
export default function SchedulingAssistant({ people, availability, loading, error, dayStart, start, end, onMoveStart, onShiftDay }) {
  const scroller = useRef(null);
  const durationMins = Math.max(15, Math.round((end - start) / 60000));
  const emails = people.map((p) => p.email);
  const dayKey = dayStart.getTime();
  const emailsKey = emails.join(",");
  const startKey = start ? start.getTime() : 0;

  // Bring the meeting into view when the day changes.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const hour = start && start.getTime() - dayKey < DAY_MS && start.getTime() >= dayKey ? start.getHours() : 8;
    el.scrollLeft = Math.max(0, (hour - 2) * HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const suggestions = useMemo(
    () => (availability ? suggestTimes({ availability, emails, dayStart, durationMins, prefer: start }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availability, emailsKey, dayKey, durationMins, startKey],
  );
  const everyone = useMemo(
    () => combineBusy(emails.map((e) => availability?.get(e.toLowerCase()))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availability, emailsKey],
  );
  const allFree = availability && start && end && !everyone.some((b) => b.start < end && b.end > start);
  const meetingOnDay = start && start.getTime() >= dayKey && start.getTime() < dayKey + DAY_MS;

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const myOffset = -start.getTimezoneOffset();

  return (
    <section className="sa" aria-label="Scheduling assistant">
      <div className="sa-head">
        <button type="button" className="cal-icon-btn" onClick={() => onShiftDay(-1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <strong className="sa-day">{dayStart.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</strong>
        <button type="button" className="cal-icon-btn" onClick={() => onShiftDay(1)} aria-label="Next day"><ChevronRight size={16} /></button>
        <div className="sa-legend" aria-hidden="true">
          <span><i className="sa-key sa-key-busy" /> Busy</span>
          <span><i className="sa-key sa-key-off" /> Outside working hours</span>
          <span><i className="sa-key sa-key-mtg" /> This meeting</span>
        </div>
      </div>

      <div className="sa-status" aria-live="polite">
        {loading ? "Checking availability…"
          : error ? error
          : allFree ? <span className="sa-ok">Everyone is free at this time.</span>
          : <span className="sa-warn">Not everyone is free at this time.</span>}
      </div>

      {!loading && !error && (
        <div className="sa-suggest">
          <Sparkles size={14} aria-hidden="true" />
          {suggestions.length ? (
            <>
              <span>Everyone&apos;s free at</span>
              {suggestions.map((s) => (
                <button key={s.getTime()} type="button" className={`sa-chip${start && s.getTime() === start.getTime() ? " active" : ""}`} onClick={() => onMoveStart(s)}>
                  {fmt(s)}
                </button>
              ))}
            </>
          ) : (
            <span>No {durationMins}-minute slot where everyone is free during working hours on this day — try another day.</span>
          )}
        </div>
      )}

      <div className="sa-grid">
        <div className="sa-names">
          <div className="sa-name sa-name-head">Attendees</div>
          <div className="sa-name sa-name-all">All attendees</div>
          {people.map((p) => {
            const info = availability?.get(p.email.toLowerCase());
            const st = availability && start && end ? statusFor(info, start, end) : "unknown";
            const theirOffset = tzOffsetMinutes(info?.timeZone || p.timeZone, start);
            const theirTime = theirOffset !== null && theirOffset !== myOffset && start
              ? start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: info?.timeZone || p.timeZone })
              : null;
            return (
              <div key={p.email} className="sa-name" title={p.email}>
                <span className="person-avatar-circle sa-av" style={{ background: p.color || "var(--brand-500)" }} aria-hidden="true">
                  {initials(p.name, p.email)}
                  <i className={`sa-dot sa-dot-${st}`} />
                </span>
                <span className="sa-name-text">
                  <span className="sa-name-main">{p.name || p.email}{p.isYou ? " (you)" : ""}</span>
                  <span className="sa-name-sub">
                    {st === "busy" ? "Busy" : st === "free" ? "Free" : info && !info.inWorkspace ? "No information" : "—"}
                    {theirTime ? ` · ${theirTime} their time` : ""}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="sa-scroll" ref={scroller}>
          <div className="sa-canvas" style={{ width: 24 * HOUR_PX }}>
            <div className="sa-hours" aria-hidden="true">
              {hours.map((h) => (
                <span key={h} style={{ width: HOUR_PX }}>
                  {new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}
                </span>
              ))}
            </div>
            <Track blocks={everyone} dayStart={dayStart} work={null} onPick={onMoveStart} label="All attendees" />
            {people.map((p) => {
              const info = availability?.get(p.email.toLowerCase());
              return (
                <Track
                  key={p.email}
                  blocks={info?.busy}
                  dayStart={dayStart}
                  work={workingWindow(info?.timeZone || p.timeZone, dayStart)}
                  unknown={info && !info.inWorkspace}
                  onPick={onMoveStart}
                  label={p.name || p.email}
                />
              );
            })}
            {meetingOnDay && (
              <span
                className={`sa-meeting${allFree ? "" : " sa-meeting-clash"}`}
                style={{ left: `${pct(start, dayStart)}%`, width: `${Math.max(0.5, pct(end, dayStart) - pct(start, dayStart))}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      </div>
      <p className="sa-hint">Click a time on the grid to move the meeting there. Only busy times are shown — never meeting titles.</p>
    </section>
  );
}
