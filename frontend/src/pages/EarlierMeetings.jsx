import { lazy, Suspense } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

const Meetings = lazy(() => import("./Meetings"));
const MeetingAssistant = lazy(() => import("./MeetingAssistant"));

/**
 * Meetings recorded before the merge, kept readable: notes written on the old Meetings page and
 * sessions from the first Meeting assistant. New meetings are added on the Meetings page.
 */
export default function EarlierMeetings() {
  const { pathname } = useLocation();
  const assistant = pathname.startsWith("/meetings/earlier/assistant");
  return (
    <div className="earlier-meetings">
      <div className="earlier-meetings-bar" role="note">
        <span>
          Earlier meetings, from before Meetings became one page. Add new ones on{" "}
          <Link to="/meetings">Meetings</Link>.
        </span>
        <nav className="earlier-meetings-tabs" aria-label="Earlier meetings">
          <Link to="/meetings/earlier" aria-current={!assistant ? "page" : undefined} className={!assistant ? "is-active" : ""}>Notes</Link>
          <Link to="/meetings/earlier/assistant" aria-current={assistant ? "page" : undefined} className={assistant ? "is-active" : ""}>Assistant sessions</Link>
        </nav>
      </div>
      <Suspense fallback={<p className="uma-hint" role="status">Loading…</p>}>
        {assistant ? <MeetingAssistant /> : <Meetings />}
      </Suspense>
    </div>
  );
}

/** /ai-meeting-assistant/:id (and its ?tab=…) now lives at /meetings/:id. */
export function MeetingRedirect() {
  const { id } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/meetings${id ? `/${id}` : ""}${search}`} replace />;
}

/** The first assistant's links (/meeting-assistant?session=…) open its sessions under Earlier meetings. */
export function OldAssistantRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  return <Navigate to={params.get("session") ? `/meetings/earlier/assistant${search}` : `/meetings${search}`} replace />;
}
