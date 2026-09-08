import { AlertTriangle } from "lucide-react";

const PRIORITY_COLOR = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#10b981" };
const RAID_STATUS_LABEL = { OPEN: "Open", IN_PROGRESS: "In progress" };

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

function projectName(projects, id) {
  return projects?.find(p => p.id === id)?.name || "Unknown project";
}

/** Small, non-punitive badge — "carried forward 3× — worth a decision today?" */
export function RepeatedCarryForwardBadge({ count }) {
  if (!count || count < 3) return null;
  return (
    <span className="cont-repeat-badge" title="Worth a decision today?">
      <AlertTriangle size={11} /> {count}×
    </span>
  );
}

function ActionItemRow({ item, projects, onComplete, onDefer, onDismiss, onCarry }) {
  const overdue = item.dueDate && new Date(item.dueDate) < new Date()
    && !["COMPLETED", "DISMISSED"].includes(item.status);
  return (
    <div className={`cont-row${overdue ? " cont-row--overdue" : ""}`}>
      <span className="cont-row-dot" style={{ background: PRIORITY_COLOR[item.priority] || "#f59e0b" }} />
      <div className="cont-row-body">
        <div className="cont-row-title">
          {item.title}
          <RepeatedCarryForwardBadge count={item.meetingIds ? item.meetingIds.length - 1 : 0} />
          {item.status === "DEFERRED" && <span className="cont-tag cont-tag--deferred">Deferred</span>}
        </div>
        <div className="cont-row-meta">
          {item.owner && <span>👤 {item.owner}</span>}
          {item.dueDate && <span className={overdue ? "cont-overdue-text" : ""}>📅 {fmtDate(item.dueDate)}{overdue ? " · overdue" : ""}</span>}
          {item.projectIds?.length > 0 && <span>{item.projectIds.map(id => projectName(projects, id)).join(", ")}</span>}
        </div>
      </div>
      <div className="cont-row-actions">
        {onCarry   && <button className="cont-btn" onClick={() => onCarry(item)}>Carry in</button>}
        {onComplete && <button className="cont-btn cont-btn--good" onClick={() => onComplete(item)}>✓ Done</button>}
        {onDefer    && <button className="cont-btn" onClick={() => onDefer(item)}>Defer</button>}
        {onDismiss  && <button className="cont-btn cont-btn--muted" onClick={() => onDismiss(item)}>Dismiss</button>}
      </div>
    </div>
  );
}

function RaidRow({ entry, onCarry, onResolve }) {
  return (
    <div className="cont-row">
      <span className="cont-row-dot" style={{ background: entry.type === "RISK" ? "#f59e0b" : "#ef4444" }} />
      <div className="cont-row-body">
        <div className="cont-row-title">{entry.title}</div>
        <div className="cont-row-meta">
          {entry.owner && <span>👤 {entry.owner}</span>}
          <span>{RAID_STATUS_LABEL[entry.status] || entry.status}</span>
          {entry.impact && <span>Impact: {entry.impact}</span>}
        </div>
      </div>
      <div className="cont-row-actions">
        {onCarry   && <button className="cont-btn" onClick={() => onCarry(entry)}>Carry in</button>}
        {onResolve && <button className="cont-btn cont-btn--good" onClick={() => onResolve(entry)}>Resolve</button>}
      </div>
    </div>
  );
}

function DecisionRow({ decision, onCarry }) {
  return (
    <div className="cont-row">
      <span className="cont-row-dot" style={{ background: "#8b5cf6" }} />
      <div className="cont-row-body">
        <div className="cont-row-title">{decision.title}</div>
        <div className="cont-row-meta">
          <span>Pending decision</span>
          {decision.madeBy && <span>👤 {decision.madeBy}</span>}
        </div>
      </div>
      {onCarry && <div className="cont-row-actions"><button className="cont-btn" onClick={() => onCarry(decision)}>Carry in</button></div>}
    </div>
  );
}

/**
 * Renders a carry-forward context payload (from GET /meetings/prepare,
 * /meetings/{id}/continuity, or the Dashboard meeting-pulse endpoint).
 *
 * Callbacks are optional — omit them to render a read-only view (e.g. the
 * pre-meeting "prepare" panel), or supply them to allow acting on items
 * directly (e.g. from inside an open meeting).
 */
export default function MeetingContinuityPanel({
  data, projects, title = "Where do we stand?",
  onCompleteActionItem, onDeferActionItem, onDismissActionItem, onCarryActionItem,
  onResolveBlocker, onCarryBlocker, onCarryDecision,
}) {
  if (!data) return null;
  const { actionItems = [], blockers = [], risks = [], decisions = [], atRiskProjects = [], counts = {} } = data;

  const nothingPending = actionItems.length === 0 && blockers.length === 0
    && risks.length === 0 && decisions.length === 0 && atRiskProjects.length === 0;

  return (
    <div className="cont-panel">
      <div className="cont-panel-header">
        <span className="cont-panel-title">{title}</span>
        {!nothingPending && (
          <div className="cont-chips">
            {counts.openActionItems > 0 && <span className="cont-chip">{counts.openActionItems} open action{counts.openActionItems > 1 ? "s" : ""}</span>}
            {counts.overdueActionItems > 0 && <span className="cont-chip cont-chip--danger">{counts.overdueActionItems} overdue</span>}
            {counts.activeBlockers > 0 && <span className="cont-chip cont-chip--danger">{counts.activeBlockers} blocker{counts.activeBlockers > 1 ? "s" : ""}</span>}
            {counts.activeRisks > 0 && <span className="cont-chip cont-chip--warn">{counts.activeRisks} risk{counts.activeRisks > 1 ? "s" : ""}</span>}
            {counts.pendingDecisions > 0 && <span className="cont-chip">{counts.pendingDecisions} pending decision{counts.pendingDecisions > 1 ? "s" : ""}</span>}
          </div>
        )}
      </div>

      {nothingPending ? (
        <div className="cont-empty">You're all caught up. 🎉</div>
      ) : (
        <>
          {atRiskProjects.length > 0 && (
            <div className="cont-section">
              <div className="cont-section-label">⚠️ Needs attention</div>
              {atRiskProjects.map(p => (
                <div key={p.projectId} className="cont-row">
                  <span className="cont-row-dot" style={{ background: p.statusSnapshot === "BLOCKED" ? "#ef4444" : "#f59e0b" }} />
                  <div className="cont-row-body">
                    <div className="cont-row-title">{projectName(projects, p.projectId)} — {p.statusSnapshot === "BLOCKED" ? "Blocked" : "At Risk"}</div>
                    {p.discussionNotes && <div className="cont-row-meta">{p.discussionNotes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {actionItems.length > 0 && (
            <div className="cont-section">
              <div className="cont-section-label">✅ Open action items ({actionItems.length})</div>
              {actionItems.map(item => (
                <ActionItemRow key={item.id} item={item} projects={projects}
                  onComplete={onCompleteActionItem} onDefer={onDeferActionItem}
                  onDismiss={onDismissActionItem} onCarry={onCarryActionItem} />
              ))}
            </div>
          )}

          {blockers.length > 0 && (
            <div className="cont-section">
              <div className="cont-section-label">🚧 Active blockers ({blockers.length})</div>
              {blockers.map(b => <RaidRow key={b.id} entry={b} onCarry={onCarryBlocker} onResolve={onResolveBlocker} />)}
            </div>
          )}

          {risks.length > 0 && (
            <div className="cont-section">
              <div className="cont-section-label">⚡ Active risks ({risks.length})</div>
              {risks.map(r => <RaidRow key={r.id} entry={r} onCarry={onCarryBlocker} />)}
            </div>
          )}

          {decisions.length > 0 && (
            <div className="cont-section">
              <div className="cont-section-label">⚖️ Pending decisions ({decisions.length})</div>
              {decisions.map(d => <DecisionRow key={d.id} decision={d} onCarry={onCarryDecision} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
