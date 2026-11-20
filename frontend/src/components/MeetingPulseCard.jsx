import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar } from "lucide-react";
import { getUmaDashboard, getUmaPrepare } from "../api/aiMeetingAssistant";

const sameDay = (iso) => {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * "Does anything need my attention today?" at a glance, from Meetings: today's meetings, meetings waiting for
 * review, and what is still open across them (action items, overdue, blockers).
 */
export default function MeetingPulseCard() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let live = true;
    Promise.all([getUmaDashboard(), getUmaPrepare()])
      .then(([d, p]) => { if (live) setState({ dash: d.data, counts: p.data?.counts || {} }); })
      .catch(() => { if (live) setState({ error: true }); });
    return () => { live = false; };
  }, []);

  if (state.loading) return null;   // non-blocking widget: the dashboard doesn't wait on it
  const header = (
    <div className="db-card-header">
      <span className="db-card-title"><Calendar size={13} aria-hidden="true" /> Daily meeting pulse</span>
      <button type="button" className="db-link" onClick={() => navigate("/meetings")}>Open meetings →</button>
    </div>
  );
  if (state.error) return <div className="db-card">{header}<div className="db-empty">Couldn't load meetings right now.</div></div>;

  const { dash, counts } = state;
  const today = [...(dash.upcoming || []), ...(dash.inProgress || []), ...(dash.recent || [])]
    .filter((m, i, all) => sameDay(m.meetingAt) && all.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) => String(a.meetingAt).localeCompare(String(b.meetingAt)));
  const toReview = dash.awaitingReview?.length || 0;
  const figures = [
    { label: "open actions", value: counts.openActionItems || 0 },
    { label: "overdue", value: counts.overdueActionItems || 0, late: true },
    { label: "blockers", value: counts.activeBlockers || 0, late: true },
    { label: "to review", value: toReview },
  ].filter((f) => f.value > 0 || f.label === "open actions");

  return (
    <div className="db-card">
      {header}
      {today.length > 0 ? (
        <ul className="pulse-list">
          {today.slice(0, 3).map((m) => (
            <li key={m.id}>
              <button type="button" className="pulse-row" onClick={() => navigate(`/meetings/${m.id}`)}>
                <span>{m.title}</span><time>{fmtTime(m.meetingAt)}</time>
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="db-empty pulse-gap">No meetings today.</div>}
      <dl className="pulse-figures">
        {figures.map((f) => (
          <div key={f.label} className={f.late && f.value > 0 ? "is-late" : ""}><dt>{f.label}</dt><dd>{f.value}</dd></div>
        ))}
      </dl>
    </div>
  );
}
