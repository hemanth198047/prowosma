import { statusText } from "../utils/statusText";
import { useState, useEffect, useRef, useCallback } from "react";
import { unwrapList } from "../api/client";
import client from "../api/client";
import {
  getRecentActivity,
  getWorkspaceHealth,
} from "../api/activity";
import PageHeader from "../components/PageHeader";
import { timeAgo } from "../utils/dateUtils";
import {
  exportActivityTXT,
  exportActivityPDF, exportActivityDOCX,
} from "../utils/activityExport";

/* ─── constants ───────────────────────────────────────────────── */
const ACTION_META = {
  // Projects
  PROJECT_CREATED:          { label: "Created",           cls: "created",  group: "PROJECT" },
  PROJECT_UPDATED:          { label: "Updated",           cls: "updated",  group: "PROJECT" },
  PROJECT_DELETED:          { label: "Deleted",           cls: "deleted",  group: "PROJECT" },
  PROJECT_ARCHIVED:         { label: "Archived",          cls: "archived", group: "PROJECT" },
  PROJECT_REOPENED:         { label: "Reopened",          cls: "created",  group: "PROJECT" },
  PROJECT_OWNER_CHANGED:    { label: "Owner Changed",     cls: "warning",  group: "PROJECT" },
  PROJECT_DEADLINE_CHANGED: { label: "Deadline Changed",  cls: "warning",  group: "PROJECT" },
  PROJECT_STATUS_CHANGED:   { label: "Status Changed",    cls: "status",   group: "PROJECT" },
  // Tasks
  TASK_CREATED:             { label: "Created",           cls: "created",  group: "TASK" },
  TASK_UPDATED:             { label: "Updated",           cls: "updated",  group: "TASK" },
  TASK_DELETED:             { label: "Deleted",           cls: "deleted",  group: "TASK" },
  TASK_COMPLETED:           { label: "Completed",         cls: "completed",group: "TASK" },
  TASK_STATUS_CHANGED:      { label: "Status Changed",    cls: "status",   group: "TASK" },
  TASK_PRIORITY_CHANGED:    { label: "Priority Changed",  cls: "warning",  group: "TASK" },
  TASK_ASSIGNED:            { label: "Assigned",          cls: "updated",  group: "TASK" },
  TASK_UNASSIGNED:          { label: "Unassigned",        cls: "updated",  group: "TASK" },
  TASK_BLOCKED:             { label: "Blocked",           cls: "deleted",  group: "TASK" },
  TASK_UNBLOCKED:           { label: "Unblocked",         cls: "created",  group: "TASK" },
  // Goals
  GOAL_CREATED:             { label: "Created",           cls: "created",  group: "GOAL" },
  GOAL_UPDATED:             { label: "Updated",           cls: "updated",  group: "GOAL" },
  GOAL_DELETED:             { label: "Deleted",           cls: "deleted",  group: "GOAL" },
  GOAL_COMPLETED:           { label: "Completed",         cls: "completed",group: "GOAL" },
  GOAL_PROGRESS_CHANGED:    { label: "Progress Updated",  cls: "progress", group: "GOAL" },
  SUBGOAL_CREATED:          { label: "Sub-goal Added",    cls: "created",  group: "GOAL" },
  STEP_COMPLETED:           { label: "Step Completed",    cls: "completed",group: "GOAL" },
  // Team
  USER_INVITED:             { label: "Invited",           cls: "created",  group: "TEAM" },
  USER_REMOVED:             { label: "Removed",           cls: "deleted",  group: "TEAM" },
  ROLE_CHANGED:             { label: "Role Changed",      cls: "warning",  group: "TEAM" },
  WORKSPACE_JOINED:         { label: "Joined",            cls: "created",  group: "TEAM" },
  WORKSPACE_LEFT:           { label: "Left",              cls: "deleted",  group: "TEAM" },
  // Time
  TIME_LOGGED:              { label: "Time Logged",       cls: "updated",  group: "TIME" },
  TIME_APPROVED:            { label: "Time Approved",     cls: "completed",group: "TIME" },
  BUDGET_LIMIT_REACHED:     { label: "Budget Alert",      cls: "deleted",  group: "TIME" },
  // Legacy
  CREATED:                  { label: "Created",           cls: "created",  group: "OTHER" },
  UPDATED:                  { label: "Updated",           cls: "updated",  group: "OTHER" },
  DELETED:                  { label: "Deleted",           cls: "deleted",  group: "OTHER" },
  STATUS_CHANGED:           { label: "Status Changed",    cls: "status",   group: "OTHER" },
  PROGRESS_UPDATED:         { label: "Progress Updated",  cls: "progress", group: "OTHER" },
};

const ENTITY_ICON  = { PROJECT:"📁", TASK:"✅", GOAL:"🎯", TEAM:"👥", TIME:"⏱️", SECURITY:"🔒" };
const SEVERITY_CLS = { INFO:"sev-info", WARNING:"sev-warning", CRITICAL:"sev-critical" };

/* ─── sub-components ──────────────────────────────────────────── */
function Avatar({ email }) {
  const initials = email && email !== "System"
    ? email.split("@")[0].slice(0, 2).toUpperCase() : "SY";
  return <div className="al-avatar">{initials}</div>;
}

function ActionBadge({ action }) {
  const m = ACTION_META[action] || { label: action, cls: "updated" };
  return <span className={`al-badge al-badge-${m.cls}`}>{m.label}</span>;
}

function SeverityDot({ severity }) {
  if (!severity || severity === "INFO") return null;
  return <span className={`al-severity-dot ${SEVERITY_CLS[severity] || ""}`} title={severity} />;
}

function ActivityRow({ log }) {
  const eIcon = ENTITY_ICON[log.entityType] || "•";
  const user  = log.performedBy && log.performedBy !== "System"
    ? log.performedBy.split("@")[0] : "System";
  const relTime = timeAgo(log.createdAt);
  const absTime = log.createdAt
    ? new Date(log.createdAt).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })
    : "";

  return (
    <div className="al-row">
      <Avatar email={log.performedBy} />
      <div className="al-row-body">
        <div className="al-row-main">
          <SeverityDot severity={log.severity} />
          <span className="al-user">{user}</span>
          <ActionBadge action={log.action} />
          <span className="al-entity-name">{eIcon} {log.entityName}</span>
        </div>
        {/* Human-readable sentence — always show when available */}
        {log.humanReadable && (
          <div className="al-human">{log.humanReadable}</div>
        )}
        {/* Diff — show alongside sentence when both exist */}
        {log.oldValue && log.newValue && (
          <div className="al-change">
            <span className="al-change-old">{log.oldValue}</span>
            <span className="al-change-arrow">→</span>
            <span className="al-change-new">{log.newValue}</span>
          </div>
        )}
        <div className="al-row-meta">
          <span className="al-type-pill">{log.entityType}</span>
          <span className="al-rel-time" title={absTime}>{relTime}</span>
          {log.performedBy?.includes("@") && (
            <span className="al-meta-email">{log.performedBy}</span>
          )}
          {log.severity && log.severity !== "INFO" && (
            <span className={`al-severity-pill ${SEVERITY_CLS[log.severity]}`}>{log.severity}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* Burst group — collapsed session of multiple events */
function BurstGroup({ group }) {
  const [expanded, setExpanded] = useState(false);
  if (!group || !group.representative) return null;
  const rep      = group.representative;
  const count    = group.count;
  const user     = rep.performedBy?.split("@")[0] || "System";
  const relTime  = timeAgo(rep.createdAt);
  const absTime  = rep.createdAt
    ? new Date(rep.createdAt).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })
    : "";

  if (!group.isBurst) return <ActivityRow log={rep} />;

  // Build human bullet list from entries
  const bullets = (group.entries || []).map(e => {
    const m = ACTION_META[e.action] || { label: e.action?.replace(/_/g," ") || "updated" };
    if (e.oldValue && e.newValue) return `${m.label}: ${e.oldValue} → ${e.newValue}`;
    if (e.humanReadable) {
      const txt = e.humanReadable.replace(new RegExp("^" + user + " "), "");
      return txt.length > 60 ? txt.slice(0, 57) + "…" : txt;
    }
    return m.label;
  });
  const PREVIEW = 3;

  return (
    <div className="al-burst">
      <div className="al-burst-header" onClick={() => setExpanded(e => !e)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setExpanded(e => !e))?.(e); } }}>
        <Avatar email={rep.performedBy} />
        <div className="al-burst-summary">
          <div className="al-row-main">
            <span className="al-user">{user}</span>
            <span className="al-burst-count">{count} changes in one session</span>
            <span className="al-entity-name">
              {ENTITY_ICON[rep.entityType]} {rep.entityName}
            </span>
          </div>

          {/* Bullet list — always visible */}
          <div className="al-burst-bullets">
            {bullets.slice(0, expanded ? bullets.length : PREVIEW).map((b, i) => (
              <div key={i} className="al-burst-bullet">
                <span className="al-burst-bullet-dot">•</span>
                <span>{b}</span>
              </div>
            ))}
            {!expanded && bullets.length > PREVIEW && (
              <div className="al-burst-bullet al-burst-more">
                +{bullets.length - PREVIEW} more changes
              </div>
            )}
          </div>

          <div className="al-row-meta" style={{ marginTop:"4px" }}>
            <span className="al-type-pill">{rep.entityType}</span>
            <span className="al-rel-time" title={absTime}>{relTime}</span>
            <span className="al-burst-hint">{expanded ? "▲ collapse" : "▼ expand all"}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="al-burst-entries">
          {group.entries.map(l => <ActivityRow key={l.id} log={l} />)}
        </div>
      )}
    </div>
  );
}

/* Health panel */
function HealthPanel({ health }) {
  if (!health) return null;
  const vel = health.velocity || 0;
  const velColor = vel > 0 ? "var(--success)" : vel < 0 ? "var(--danger)" : "var(--gray-500)";

  return (
    <div className="al-health-panel">
      <div className="al-health-title">Workspace Health — Last 7 Days</div>
      <div className="al-health-grid">
        <div className="al-health-card">
          <div className="al-health-num">{health.eventsThisWeek}</div>
          <div className="al-health-lbl">Total Events</div>
          <div className="al-health-sub" style={{ color: velColor }}>
            {vel > 0 ? "↑" : vel < 0 ? "↓" : "→"} {Math.abs(vel)}% vs last week
          </div>
        </div>
        <div className="al-health-card">
          <div className="al-health-num" style={{ color:"var(--success)" }}>{health.completionsThisWeek}</div>
          <div className="al-health-lbl">Completions</div>
          <div className="al-health-sub">tasks + goals completed</div>
        </div>
        <div className="al-health-card">
          <div className="al-health-num" style={{ color: health.deletionsThisWeek > 5 ? "var(--danger)" : "var(--gray-500)" }}>
            {health.deletionsThisWeek}
          </div>
          <div className="al-health-lbl">Deletions</div>
          <div className="al-health-sub">projects, tasks, goals</div>
        </div>
        {health.recentAlerts?.length > 0 && (
          <div className="al-health-card al-health-card-alert">
            <div className="al-health-num" style={{ color:"var(--danger)" }}>{health.recentAlerts.length}</div>
            <div className="al-health-lbl">Risk Events</div>
            <div className="al-health-sub">warnings + critical</div>
          </div>
        )}
      </div>
      {health.recentAlerts?.length > 0 && (
        <div className="al-alerts-list">
          {health.recentAlerts.slice(0, 3).map(a => (
            <div key={a.id} className="al-alert-row">
              <span className={`al-severity-pill ${SEVERITY_CLS[a.severity]}`}>{a.severity}</span>
              <span className="al-alert-text">{a.humanReadable || a.action}</span>
              <span className="al-alert-time">
                {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Scrollable user filter with inline search for large lists */
function UserFilterSection({ users, logs, filterUser, setFilterUser }) {
  const [userSearch, setUserSearch] = useState("");
  const SHOW_SEARCH_THRESHOLD = 5;

  const visibleUsers = userSearch.trim()
    ? users.filter(u => u.toLowerCase().includes(userSearch.toLowerCase()))
    : users;

  return (
    <div>
      {users.length >= SHOW_SEARCH_THRESHOLD && (
        <input
          className="al-user-search"
          value={userSearch}
          onChange={e => setUserSearch(e.target.value)}
          placeholder="Search users…"
        />
      )}
      <div className={`al-filter-options ${users.length >= SHOW_SEARCH_THRESHOLD ? "al-user-scroll" : ""}`}>
        <div className={`al-filter-opt ${filterUser === "ALL" ? "active" : ""}`}
          onClick={() => setFilterUser("ALL")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setFilterUser("ALL"))?.(e); } }}>
          <span>All Users</span>
          <span className="al-opt-count">{logs.length}</span>
        </div>
        {visibleUsers.map(u => (
          <div key={u} className={`al-filter-opt ${filterUser === u ? "active" : ""}`}
            onClick={() => setFilterUser(filterUser === u ? "ALL" : u)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setFilterUser(filterUser === u ? "ALL" : u))?.(e); } }}>
            <div className="al-user-opt-avatar">
              {(u.includes("@") ? u.split("@")[0] : u).slice(0, 2).toUpperCase()}
            </div>
            <span className="al-user-opt-name" title={u}>
              {u.includes("@") ? u.split("@")[0] : u}
            </span>
            <span className="al-opt-count">{logs.filter(l => l.performedBy === u).length}</span>
          </div>
        ))}
        {visibleUsers.length === 0 && (
          <div style={{ fontSize:"11px", color:"var(--gray-400)", padding:"6px 7px" }}>No users match</div>
        )}
      </div>
    </div>
  );
}

/* Collapsible event group section in sidebar */
function EventGroupSection({ group, icon, count, isGroupActive, filterAction,
  onGroupClick, onActionClick, actions, actionMeta, logs }) {
  const [open, setOpen] = useState(false);
  const hasActiveAction = actions.some(a => a === filterAction);

  // Auto-open if an action in this group is active
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-opens in response to a prop changing, not on every render
    if (hasActiveAction) setOpen(true);
  }, [hasActiveAction]);

  return (
    <div className="al-sidebar-section al-event-group">
      {/* Clickable header — filters by entity type + toggles expand */}
      <div
        className={`al-event-group-header ${isGroupActive || hasActiveAction ? "active" : ""}`}
        onClick={() => { setOpen(o => !o); onGroupClick(); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => { setOpen(o => !o); onGroupClick(); })?.(e); } }}
      >
        <span className="al-event-group-icon">{icon}</span>
        <span className="al-event-group-name">{group} EVENTS</span>
        <span className="al-opt-count">{count}</span>
        <span className="al-event-group-caret">{open ? "▾" : "▸"}</span>
      </div>

      {/* Expanded individual event types */}
      {open && (
        <div className="al-filter-options al-event-group-body">
          {actions.map(a => {
            const m   = actionMeta[a];
            const cnt = logs.filter(l => l.action === a).length;
            return (
              <div key={a}
                className={`al-filter-opt al-filter-opt-sub ${filterAction === a ? "active" : ""}`}
                onClick={e => { e.stopPropagation(); onActionClick(a); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (e => { e.stopPropagation(); onActionClick(a); })?.(e); } }}
              >
                <span className={`al-dot al-dot-${m.cls}`} />
                <span>{m.label}</span>
                <span className="al-opt-count">{cnt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── main page ───────────────────────────────────────────────── */

// Build burst groups from flat activity logs (client-side grouping)
function buildBurstGroups(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return [];
  const groups = [];
  const BURST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  let i = 0;
  while (i < logs.length) {
    const anchor = logs[i];
    if (!anchor) { i++; continue; }
    const anchorTime = anchor.createdAt ? new Date(anchor.createdAt).getTime() : 0;
    const burst = [anchor];
    let j = i + 1;
    while (j < logs.length && logs[j]) {
      const t = logs[j].createdAt ? new Date(logs[j].createdAt).getTime() : 0;
      if (
        logs[j].performedBy === anchor.performedBy &&
        Math.abs(anchorTime - t) < BURST_WINDOW_MS &&
        logs[j].entityType === anchor.entityType
      ) {
        burst.push(logs[j]);
        j++;
      } else break;
    }
    if (burst.length > 1) {
      groups.push({ isBurst: true, entries: burst, count: burst.length,
                    representative: burst[0], correlationId: anchor.correlationId });
    } else {
      groups.push({ isBurst: false, entries: burst, count: 1,
                    representative: anchor, correlationId: anchor.correlationId });
    }
    i = j;
  }
  return groups;
}

export default function ActivityLog() {
  const [logs, setLogs]             = useState([]);
  const [grouped, setGrouped]       = useState([]);
  const [health, setHealth]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [limit, setLimit]           = useState(100);
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");
  const [exporting, setExporting]   = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [viewMode, setViewMode]     = useState("grouped"); // grouped | flat
  const [showHealth, setShowHealth] = useState(true);
  const exportRef                    = useRef(null);

  const [searchText, setSearchText]     = useState("");
  const [filterEntity, setFilterEntity] = useState("ALL");
  const [filterAction, setFilterAction] = useState("ALL");
  const [filterUser, setFilterUser]     = useState("ALL");
  const [filterSeverity, setFilterSeverity] = useState("ALL");
  const [groupBy, setGroupBy]           = useState("date");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [flatRes, healthRes] = await Promise.all([
        fromDate && toDate
          ? client.get(`/activity?from=${new Date(fromDate).toISOString()}&to=${new Date(toDate + "T23:59:59").toISOString()}&limit=500`)
          : getRecentActivity(limit),
        getWorkspaceHealth(),
      ]);
      setLogs(unwrapList(flatRes));
      // Build client-side burst groups from flat logs
      const flatLogs = unwrapList(flatRes);
      const builtGroups = buildBurstGroups(flatLogs);
      setGrouped(builtGroups);
      setHealth(healthRes.data || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [fromDate, toDate, limit]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount/dep-change pattern
  useEffect(() => { loadAll(); }, [loadAll]);

  // Close export dropdown on outside click
  useEffect(() => {
    const h = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleExport = async (format) => {
    setExportOpen(false);
    setExporting(true);
    const name = `audit-log-${new Date().toISOString().slice(0, 10)}`;
    try {
      if (format === "csv") {
        let url = "/activity/export";
        if (fromDate && toDate) url += `?from=${new Date(fromDate).toISOString()}&to=${new Date(toDate + "T23:59:59").toISOString()}`;
        const res  = await client.get(url, { responseType: "blob" });
        const blob = new Blob([res.data], { type: "text/csv" });
        const link = document.createElement("a");
        link.href  = URL.createObjectURL(blob);
        link.download = `${name}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      } else if (format === "txt")  { exportActivityTXT(filtered, name); }
        else if (format === "pdf")  { exportActivityPDF(filtered, name); }
        else if (format === "docx") { await exportActivityDOCX(filtered, name); }
    } catch (e) { console.error(e); }
    finally { setExporting(false); }
  };

  const clearDates  = () => { setFromDate(""); setToDate(""); setTimeout(loadAll, 0); };
  const resetAll    = () => {
    setFilterEntity("ALL"); setFilterAction("ALL"); setFilterUser("ALL");
    setFilterSeverity("ALL"); setSearchText(""); setFromDate(""); setToDate("");
  };

  /* Flat filtered list */
  const filtered = logs.filter(l => {
    if (filterEntity !== "ALL" && l.entityType !== filterEntity) return false;
    if (filterAction !== "ALL" && l.action !== filterAction) return false;
    if (filterUser   !== "ALL" && l.performedBy !== filterUser) return false;
    if (filterSeverity !== "ALL" && l.severity !== filterSeverity) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      return (l.entityName?.toLowerCase().includes(q) ||
              l.performedBy?.toLowerCase().includes(q) ||
              l.action?.toLowerCase().includes(q)      ||
              l.humanReadable?.toLowerCase().includes(q) ||
              l.oldValue?.toLowerCase().includes(q)    ||
              l.newValue?.toLowerCase().includes(q));
    }
    return true;
  });

  /* Filter grouped data using same criteria */
  const filteredGrouped = (Array.isArray(grouped) ? grouped : [])
    .filter(g => g != null && (g.representative != null || (g.isBurst && g.entries)))
    .map(g => {
    // For burst groups, filter individual entries
    if (g.isBurst && g.entries) {
      const filteredEntries = g.entries.filter(l => {
        if (filterEntity !== "ALL" && l.entityType !== filterEntity) return false;
        if (filterAction !== "ALL" && l.action !== filterAction) return false;
        if (filterUser   !== "ALL" && l.performedBy !== filterUser) return false;
        if (filterSeverity !== "ALL" && l.severity !== filterSeverity) return false;
        if (searchText.trim()) {
          const q = searchText.toLowerCase();
          return (l.entityName?.toLowerCase().includes(q) ||
                  l.performedBy?.toLowerCase().includes(q) ||
                  l.action?.toLowerCase().includes(q)      ||
                  l.humanReadable?.toLowerCase().includes(q));
        }
        return true;
      });
      if (filteredEntries.length === 0) return null;
      return { ...g, entries: filteredEntries, count: filteredEntries.length,
               representative: filteredEntries[0] };
    }
    // Single entry — filter the representative
    const rep = g.representative;
    if (!rep) return null;
    if (filterEntity !== "ALL" && rep.entityType !== filterEntity) return null;
    if (filterAction !== "ALL" && rep.action !== filterAction) return null;
    if (filterUser   !== "ALL" && rep.performedBy !== filterUser) return null;
    if (filterSeverity !== "ALL" && rep.severity !== filterSeverity) return null;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const matches = rep.entityName?.toLowerCase().includes(q) ||
                      rep.performedBy?.toLowerCase().includes(q) ||
                      rep.action?.toLowerCase().includes(q)      ||
                      rep.humanReadable?.toLowerCase().includes(q);
      if (!matches) return null;
    }
    return g;
  }).filter(Boolean);

  /* Group flat list */
  const flatGrouped = filtered.reduce((acc, log) => {
    let key;
    if (groupBy === "date") {
      key = new Date(log.createdAt).toLocaleDateString("en-US", {
        weekday:"long", year:"numeric", month:"long", day:"numeric" });
    } else if (groupBy === "entity") {
      key = `${ENTITY_ICON[log.entityType]||"•"} ${log.entityType} — ${log.entityName||"Unknown"}`;
    } else {
      key = log.performedBy || "System";
    }
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const uniqueUsers = [...new Set(logs.map(l => l.performedBy).filter(Boolean))];
  const hasFilters  = filterEntity !== "ALL" || filterAction !== "ALL" ||
                      filterUser !== "ALL" || filterSeverity !== "ALL" || searchText || fromDate || toDate;

  /* Action counts for sidebar */
  const actionGroups = {
    PROJECT: Object.keys(ACTION_META).filter(a => ACTION_META[a].group === "PROJECT"),
    TASK:    Object.keys(ACTION_META).filter(a => ACTION_META[a].group === "TASK"),
    GOAL:    Object.keys(ACTION_META).filter(a => ACTION_META[a].group === "GOAL"),
    TEAM:    Object.keys(ACTION_META).filter(a => ACTION_META[a].group === "TEAM"),
  };
  const entityCounts = ["PROJECT","TASK","GOAL","TEAM","TIME"].reduce((acc, e) => {
    acc[e] = logs.filter(l => l.entityType === e).length; return acc;
  }, {});

  return (
    <div>
      <PageHeader
        icon="📋"
        title="Audit Log"
        description="Operational intelligence — complete compliance-grade activity trail"
        action={
          <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
            <button
              className={`btn-secondary ${showHealth ? "btn-active" : ""}`}
              style={{ fontSize:"12px", padding:"7px 12px" }}
              onClick={() => setShowHealth(s => !s)}
            >
              Health
            </button>
            <div className="al-export-wrap" ref={exportRef}>
              <button className="btn-secondary"
                style={{ fontSize:"12px", padding:"7px 12px", display:"flex", alignItems:"center", gap:"5px" }}
                disabled={exporting} onClick={() => setExportOpen(o => !o)}>
                {exporting ? "⏳" : "↓ Export"} <span style={{ fontSize:"9px", opacity:0.6 }}>▼</span>
              </button>
              {exportOpen && (
                <div className="al-export-dropdown">
                  {[
                    { fmt:"csv",  icon:"📊", label:"CSV Spreadsheet",       sub:"Comma-separated values" },
                    { fmt:"txt",  icon:"📄", label:"Plain Text (.txt)",     sub:"Human-readable log"     },
                    { fmt:"pdf",  icon:"📕", label:"PDF Document",          sub:"Formatted, printable"   },
                    { fmt:"docx", icon:"📘", label:"Word Document (.docx)", sub:"Editable in MS Word"    },
                  ].map(({ fmt, icon, label, sub }) => (
                    <button key={fmt} className="al-export-item" onClick={() => handleExport(fmt)}>
                      <span className="al-export-icon">{icon}</span>
                      <span>
                        <span className="al-export-label">{label}</span>
                        <span className="al-export-sub">{sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-secondary" style={{ fontSize:"12px", padding:"7px 12px" }} onClick={loadAll}>
              ↺ Refresh
            </button>
          </div>
        }
      />

      {/* Health panel */}
      {showHealth && <HealthPanel health={health} />}

      <div className="al-layout">
        {/* ── LEFT SIDEBAR ── */}
        <aside className="al-sidebar">
          <div className="al-sidebar-section">
            <input className="al-search-input" value={searchText}
              onChange={e => setSearchText(e.target.value)} placeholder="Search…" />
          </div>

          {/* Entity type */}
          <div className="al-sidebar-section">
            <div className="al-sidebar-label">Type</div>
            <div className="al-filter-options">
              {[["ALL","All Types", logs.length], ...["PROJECT","TASK","GOAL","TEAM","TIME"].map(
                e => [e, statusText(e), entityCounts[e]])].map(([val, label, cnt]) => (
                <div key={val} className={`al-filter-opt ${filterEntity === val ? "active":""}`}
                  onClick={() => setFilterEntity(filterEntity === val && val !== "ALL" ? "ALL" : val)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setFilterEntity(filterEntity === val && val !== "ALL" ? "ALL" : val))?.(e); } }}>
                  <span>{label}</span>
                  <span className="al-opt-count">{cnt}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action by entity group — collapsible */}
          {Object.entries(actionGroups).map(([group, actions]) => {
            const groupCount = logs.filter(l => l.entityType === group).length;
            if (groupCount === 0) return null;
            const isGroupActive = filterEntity === group;
            const visibleActions = actions.filter(a => logs.some(l => l.action === a));
            return (
              <EventGroupSection
                key={group}
                group={group}
                icon={ENTITY_ICON[group]}
                count={groupCount}
                isGroupActive={isGroupActive}
                filterAction={filterAction}
                onGroupClick={() => {
                  setFilterEntity(isGroupActive ? "ALL" : group);
                  setFilterAction("ALL");
                }}
                onActionClick={(a) => {
                  setFilterEntity(group);
                  setFilterAction(filterAction === a ? "ALL" : a);
                }}
                actions={visibleActions}
                actionMeta={ACTION_META}
                logs={logs}
              />
            );
          })}

          {/* Severity */}
          <div className="al-sidebar-section">
            <div className="al-sidebar-label">Severity</div>
            <div className="al-filter-options">
              {[["ALL","All"], ["INFO","Info"], ["WARNING","Warning"], ["CRITICAL","Critical"]].map(
                ([val, lbl]) => (
                <div key={val} className={`al-filter-opt ${filterSeverity === val ? "active":""}`}
                  onClick={() => setFilterSeverity(val)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setFilterSeverity(val))?.(e); } }}>
                  <span>{lbl}</span>
                  <span className="al-opt-count">
                    {val === "ALL" ? logs.length : logs.filter(l => l.severity === val).length}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Users */}
          {uniqueUsers.length > 0 && (
            <div className="al-sidebar-section">
              <div className="al-sidebar-label">User</div>
              <UserFilterSection
                users={uniqueUsers}
                logs={logs}
                filterUser={filterUser}
                setFilterUser={setFilterUser}
              />
            </div>
          )}

          {/* Date + controls */}
          <div className="al-sidebar-section">
            <div className="al-sidebar-label">Date Range</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
              <input type="date" aria-label="From date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="al-date-input" />
              <input type="date" aria-label="To date" value={toDate}   onChange={e => setToDate(e.target.value)}   className="al-date-input" />
              <button className="btn-primary" style={{ fontSize:"12px", padding:"6px" }}
                disabled={!fromDate || !toDate} onClick={loadAll}>Apply</button>
              {(fromDate || toDate) && (
                <button className="btn-secondary" style={{ fontSize:"11px", padding:"5px" }} onClick={clearDates}>
                  ✕ Clear
                </button>
              )}
            </div>
          </div>

          <div className="al-sidebar-section">
            <div className="al-sidebar-label">View Mode</div>
            <div className="al-filter-options">
              {[["grouped","Smart Grouped"], ["flat","Flat List"]].map(([v, l]) => (
                <div key={v} className={`al-filter-opt ${viewMode === v ? "active":""}`}
                  onClick={() => setViewMode(v)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => setViewMode(v))?.(e); } }}>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {viewMode === "flat" && (
            <div className="al-sidebar-section">
              <div className="al-sidebar-label">Group By</div>
              <select className="al-select" aria-label="Group by" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                <option value="date">Date</option>
                <option value="entity">Entity</option>
                <option value="user">User</option>
              </select>
            </div>
          )}

          <div className="al-sidebar-section">
            <div className="al-sidebar-label">Show</div>
            <select className="al-select" aria-label="Number of entries" value={limit} onChange={e => setLimit(Number(e.target.value))}>
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={200}>Last 200</option>
              <option value={500}>Last 500</option>
            </select>
          </div>

          {hasFilters && (
            <div className="al-sidebar-section">
              <button className="btn-secondary" style={{ width:"100%", fontSize:"12px", padding:"7px" }}
                onClick={resetAll}>✕ Reset Filters</button>
            </div>
          )}
        </aside>

        {/* ── RIGHT FEED ── */}
        <div className="al-feed">
          <div className="al-feed-header">
            <span className="al-feed-count">
              <strong>{viewMode === "grouped" ? filteredGrouped.length : filtered.length}</strong> {viewMode === "grouped" ? "sessions" : "entries"}
              {hasFilters && <span className="al-filtered-badge">filtered</span>}
            </span>
          </div>

          {loading ? (
            <p className="empty-state">Loading…</p>
          ) : (viewMode === "grouped" ? filteredGrouped : Object.keys(flatGrouped)).length === 0 ? (
            <div className="al-empty">
              <div style={{ fontSize:"36px", marginBottom:"8px" }}>📋</div>
              <p style={{ fontWeight:600, color:"var(--gray-600)" }}>No activity found</p>
              {hasFilters && (
                <button className="btn-secondary" style={{ marginTop:"12px", fontSize:"12px" }}
                  onClick={resetAll}>Reset Filters</button>
              )}
            </div>
          ) : viewMode === "grouped" ? (
            /* Smart grouped view */
            <div className="al-timeline">
              {filteredGrouped.map(g => <BurstGroup key={g.correlationId} group={g} />)}
            </div>
          ) : (
            /* Flat grouped view */
            <div className="al-timeline">
              {Object.entries(flatGrouped).map(([group, items]) => (
                <div key={group} className="al-group">
                  <div className="al-group-label">
                    {group}
                    <span className="al-group-count">{items.length} {items.length===1?"entry":"entries"}</span>
                  </div>
                  <div className="al-group-items">
                    {items.map(log => <ActivityRow key={log.id} log={log} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
