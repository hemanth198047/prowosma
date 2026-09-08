import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { TrendingUp, ChevronDown, ChevronRight } from "lucide-react";
import { getMeetingTrends } from "../api/meetings";

const RANGE_OPTIONS = [
  { value: 7,  label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

function fmtDay(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function MeetingTrendsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(14);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (rangeDays) => {
    setLoading(true);
    try {
      const r = await getMeetingTrends(rangeDays);
      setTrends(Array.isArray(r.data) ? r.data : []);
    } catch { setTrends([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (expanded && !trends) load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleRangeChange = (value) => {
    setDays(value);
    load(value);
  };

  const chartData = (trends || []).map(d => ({
    ...d,
    label: fmtDay(d.date),
  }));

  const totals = (trends || []).reduce((acc, d) => ({
    meetingsHeld: acc.meetingsHeld + d.meetingsHeld,
    actionsCreated: acc.actionsCreated + d.actionsCreated,
    actionsCompleted: acc.actionsCompleted + d.actionsCompleted,
    decisionsMade: acc.decisionsMade + d.decisionsMade,
  }), { meetingsHeld: 0, actionsCreated: 0, actionsCompleted: 0, decisionsMade: 0 });

  return (
    <div className="cont-panel trend-panel">
      <button className="trend-toggle" onClick={() => setExpanded(v => !v)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <TrendingUp size={14} />
        <span>Trends</span>
        {!expanded && <span className="trend-toggle-hint">— open vs. resolved over time</span>}
      </button>

      {expanded && (
        <div className="trend-body">
          <div className="trend-range-row">
            {RANGE_OPTIONS.map(o => (
              <button key={o.value}
                className={`meet-filter-btn${days === o.value ? " active" : ""}`}
                onClick={() => handleRangeChange(o.value)}>
                {o.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="meet-loading-inline">Loading trends…</div>
          ) : !trends || trends.length === 0 ? (
            <div className="cont-empty">Not enough meeting history yet to show trends.</div>
          ) : (
            <>
              <div className="trend-stats-row">
                <div className="trend-stat"><span className="trend-stat-num">{totals.meetingsHeld}</span><span className="trend-stat-label">Meetings held</span></div>
                <div className="trend-stat"><span className="trend-stat-num">{totals.actionsCreated}</span><span className="trend-stat-label">Actions created</span></div>
                <div className="trend-stat"><span className="trend-stat-num" style={{ color: "#10b981" }}>{totals.actionsCompleted}</span><span className="trend-stat-label">Actions completed</span></div>
                <div className="trend-stat"><span className="trend-stat-num">{totals.decisionsMade}</span><span className="trend-stat-label">Decisions made</span></div>
              </div>

              <div className="trend-chart-block">
                <div className="trend-chart-title">Open items over time</div>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chartData} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="openActionItemsEndOfDay" name="Open actions" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} />
                    <Area type="monotone" dataKey="activeBlockersEndOfDay" name="Active blockers" stroke="#ef4444" fill="#ef4444" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="trend-chart-block">
                <div className="trend-chart-title">Actions created vs. completed</div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="actionsCreated" name="Created" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actionsCompleted" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
