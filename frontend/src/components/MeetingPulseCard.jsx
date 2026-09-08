import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getDashboardMeetingPulse } from "../api/dashboard";

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Executive-friendly summary card — deliberately lighter than the full
 * Meeting Continuity panel on the Meetings page. Shows just enough to
 * answer "does anything need my attention today?" at a glance.
 */
export default function MeetingPulseCard() {
  const navigate = useNavigate();
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getDashboardMeetingPulse()
      .then(r => { setPulse(r.data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) return null; // non-blocking widget — dashboard shell doesn't wait on this
  if (error) {
    return (
      <div className="db-card">
        <div className="db-card-header">
          <span className="db-card-title"><Calendar size={13} /> DAILY MEETING PULSE</span>
        </div>
        <div className="db-empty">Couldn't load meeting data right now.</div>
      </div>
    );
  }
  if (!pulse) return null;

  const counts = pulse.carryForwardCounts || {};
  const hasAttention = (counts.overdueActionItems || 0) > 0
    || (counts.activeBlockers || 0) > 0 || (counts.atRiskProjects || 0) > 0;

  return (
    <div className="db-card">
      <div className="db-card-header">
        <span className="db-card-title"><Calendar size={13} /> DAILY MEETING PULSE</span>
        <button className="db-link" onClick={() => navigate("/meetings")}>Open meetings →</button>
      </div>

      {pulse.todaysMeetings?.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          {pulse.todaysMeetings.slice(0, 3).map(m => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--gray-700)" }}>{m.title}</span>
              <span style={{ color: "var(--gray-400)" }}>{fmtTime(m.meetingDate)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="db-empty" style={{ marginBottom: "10px" }}>No meetings scheduled today.</div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <PulseChip icon={CheckCircle2} value={counts.openActionItems || 0} label="open actions" color="#6366f1" />
        {(counts.overdueActionItems || 0) > 0 && (
          <PulseChip icon={AlertTriangle} value={counts.overdueActionItems} label="overdue" color="#ef4444" />
        )}
        {(counts.activeBlockers || 0) > 0 && (
          <PulseChip icon={AlertTriangle} value={counts.activeBlockers} label="blockers" color="#ef4444" />
        )}
        {(counts.atRiskProjects || 0) > 0 && (
          <PulseChip icon={AlertTriangle} value={counts.atRiskProjects} label="at-risk projects" color="#f59e0b" />
        )}
      </div>

      {!hasAttention && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#10b981", fontWeight: 600 }}>
          Nothing urgent — you're on track. 🎉
        </div>
      )}

      {pulse.recentlyCompleted?.length > 0 && (
        <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--gray-400)" }}>
          ✅ {pulse.recentlyCompleted.length} item{pulse.recentlyCompleted.length > 1 ? "s" : ""} completed in the last 48h
        </div>
      )}
    </div>
  );
}

function PulseChip({ icon: Icon, value, label, color }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontSize: "11px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px",
      background: color + "18", color,
    }}>
      <Icon size={11} /> {value} {label}
    </span>
  );
}
