import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Clock, MapPin, Users, Pencil, Trash2, Video, ExternalLink, Folder, User, AlignLeft } from "lucide-react";
import { formatRange, isLink, MEETING_TYPES } from "../../utils/calendarMeetings";
import { detectPlatform } from "../../utils/conferenceLink";

const PEEK_W = 340;
const GAP = 8;

const STATUS_LABEL = { SCHEDULED: "Scheduled", COMPLETED: "Completed", CANCELLED: "Cancelled" };

/** Place the card beside the clicked event, flipping/clamping to stay on screen. */
function place(rect, height) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) return null; // phones: CSS shows it as a bottom sheet
  let left = rect.right + GAP;
  if (left + PEEK_W > vw - GAP) left = rect.left - PEEK_W - GAP;
  if (left < GAP) left = Math.min(Math.max(GAP, rect.left), vw - PEEK_W - GAP);
  let top = rect.top;
  if (top + height > vh - GAP) top = vh - height - GAP;
  if (top < GAP) top = GAP;
  return { left, top };
}

/**
 * Outlook-style preview card for one calendar item.
 * Closes on Esc, on a click outside it, and when the calendar scrolls.
 */
export default function EventPeek({ peek, projectName, teamName, onClose, onEdit, onDelete, onOpen }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    setPos(place(peek.rect, ref.current.offsetHeight));
  }, [peek]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.(".fc-event")) onClose();
    };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useEffect(() => { ref.current?.focus(); }, [peek]);

  const { type, item, start, end, color } = peek;
  const isMeeting = type === "meeting";
  const link = isMeeting && isLink(item.location) ? item.location.trim() : null;
  const platform = link ? detectPlatform(link) : null;
  const typeLabel = isMeeting ? MEETING_TYPES.find((t) => t.value === item.meetingType)?.label || "Meeting" : null;

  const style = pos ? { left: pos.left, top: pos.top, width: PEEK_W } : undefined;

  return createPortal(
    <div
      ref={ref}
      className={`cal-peek${pos ? "" : " cal-peek-sheet"}`}
      style={style}
      role="dialog"
      aria-label={item.title || item.name || "Calendar item"}
      tabIndex={-1}
    >
      <div className="cal-peek-bar" style={{ background: color }} />
      <div className="cal-peek-head">
        <div className="cal-peek-kind">
          {isMeeting ? typeLabel : type === "task" ? "Task" : type === "project" ? "Project due" : "Goal target"}
          {isMeeting && item.status && item.status !== "SCHEDULED" && (
            <span className={`cal-peek-status cal-peek-status-${item.status.toLowerCase()}`}>{STATUS_LABEL[item.status] || item.status}</span>
          )}
          {!isMeeting && item.status && (
            <span className="cal-peek-status">{String(item.status).replace(/_/g, " ").toLowerCase()}</span>
          )}
        </div>
        <div className="cal-peek-actions">
          {isMeeting && (
            <>
              <button type="button" className="cal-icon-btn" onClick={onEdit} aria-label="Edit meeting" title="Edit (double-click)">
                <Pencil size={15} />
              </button>
              <button type="button" className="cal-icon-btn cal-danger-text" onClick={onDelete} aria-label="Delete meeting" title="Delete">
                <Trash2 size={15} />
              </button>
            </>
          )}
          <button type="button" className="cal-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <h3 className={`cal-peek-title${item.status === "CANCELLED" ? " cal-strike" : ""}`}>
        {item.title || item.name || "(No title)"}
      </h3>

      <div className="cal-peek-line">
        <Clock size={14} aria-hidden="true" />
        <span>{isMeeting ? formatRange(start, end) : start.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
      </div>

      {isMeeting && item.location && (
        <div className="cal-peek-line">
          {link ? <Video size={14} aria-hidden="true" /> : <MapPin size={14} aria-hidden="true" />}
          <span className="cal-peek-loc">{platform ? `${platform.name} meeting` : item.location}</span>
        </div>
      )}

      {isMeeting && link && (
        <a className="btn btn-primary cal-peek-join" href={link} target="_blank" rel="noopener noreferrer">
          <Video size={15} /> Join {platform?.name || "meeting"}
        </a>
      )}

      {isMeeting && item.createdBy && (
        <div className="cal-peek-line">
          <User size={14} aria-hidden="true" />
          <span>Organizer: {teamName(item.createdBy)}</span>
        </div>
      )}

      {isMeeting && item.attendees?.length > 0 && (
        <div className="cal-peek-line cal-peek-top">
          <Users size={14} aria-hidden="true" />
          <div>
            <div className="cal-peek-sub">{item.attendees.length} attendee{item.attendees.length > 1 ? "s" : ""}</div>
            <ul className="cal-peek-people">
              {item.attendees.slice(0, 6).map((a) => <li key={a}>{teamName(a)}</li>)}
              {item.attendees.length > 6 && <li className="cal-peek-sub">+{item.attendees.length - 6} more</li>}
            </ul>
          </div>
        </div>
      )}

      {item.projectId && projectName(item.projectId) && (
        <div className="cal-peek-line">
          <Folder size={14} aria-hidden="true" />
          <span>{projectName(item.projectId)}</span>
        </div>
      )}

      {isMeeting && item.agenda && (
        <div className="cal-peek-line cal-peek-top">
          <AlignLeft size={14} aria-hidden="true" />
          <p className="cal-peek-agenda">{item.agenda.length > 280 ? `${item.agenda.slice(0, 280)}…` : item.agenda}</p>
        </div>
      )}

      <div className="cal-peek-foot">
        <button type="button" className="btn cal-btn-ghost" onClick={onOpen}>
          <ExternalLink size={14} /> {isMeeting ? "Open in Meetings" : type === "task" ? "Open task" : type === "project" ? "Open project" : "Open goal"}
        </button>
      </div>
    </div>
    , document.body,
  );
}
