import { Lock, Link2, ChevronDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { getDependencies, addDependency, removeDependency } from "../api/tasks";

const statusColor = {
  TODO: "#6366f1",
  IN_PROGRESS: "#f59e0b",
  DONE: "#10b981",
};

export default function TaskDependencies({ task, allTasks, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [deps, setDeps] = useState({
    blockedBy: [],
    blocking: [],
    isBlocked: false,
  });
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    getDependencies(task.id)
      .then((res) => setDeps(res.data))
      .catch(console.error);
  }, [open, task.id]);

  const handleAdd = async (blockedByTaskId) => {
    try {
      await addDependency(task.id, blockedByTaskId);
      const res = await getDependencies(task.id);
      setDeps(res.data);
      setSearch("");
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to add dependency");
    }
  };

  const handleRemove = async (blockedByTaskId) => {
    await removeDependency(task.id, blockedByTaskId);
    const res = await getDependencies(task.id);
    setDeps(res.data);
    onRefresh();
  };

  const existingIds = [...(deps.blockedBy?.map((t) => t.id) || []), task.id];
  const searchResults = allTasks
    .filter(
      (t) =>
        !existingIds.includes(t.id) &&
        t.title.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 5);

  const blockedByCount = deps.blockedBy?.length || 0;
  const blockingCount = deps.blocking?.length || 0;
  const total = blockedByCount + blockingCount;

  return (
    <div className="task-deps-wrapper" ref={ref}>
      <button
        className="task-deps-toggle"
        style={
          deps.isBlocked
            ? {
                borderColor: "#ef4444",
                color: "#ef4444",
                background: "#fff5f5",
              }
            : {}
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {deps.isBlocked ? <Lock size={13} aria-hidden="true" /> : <Link2 size={13} aria-hidden="true" />}
        {deps.isBlocked ? "Blocked" : "Dependencies"}{total > 0 ? ` · ${total}` : ""}
        <ChevronDown size={12} aria-hidden="true" className={open ? "is-open" : undefined} />
      </button>

      {open && (
        <div className="task-deps-panel" onClick={(e) => e.stopPropagation()} role="presentation">
          <div className="task-comments-header">Task Dependencies</div>

          {deps.isBlocked && (
            <div className="deps-blocked-warning">
              🔒 This task is blocked by incomplete tasks
            </div>
          )}

          {/* Blocked by */}
          <div className="deps-section">
            <div className="deps-section-title">
              Blocked by ({blockedByCount})
            </div>
            {blockedByCount > 0 ? (
              <div className="deps-list">
                {deps.blockedBy.map((t) => (
                  <div key={t.id} className="deps-item">
                    <div
                      className="task-status-dot"
                      style={{ background: statusColor[t.status] }}
                    />
                    <span
                      className={`deps-item-title ${t.status === "DONE" ? "deps-done" : ""}`}
                    >
                      {t.title}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: statusColor[t.status] + "22",
                        color: statusColor[t.status],
                        fontSize: "10px",
                      }}
                    >
                      {t.status}
                    </span>
                    <button
                      className="btn-icon"
                      style={{ fontSize: "11px" }}
                      onClick={() => handleRemove(t.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="deps-empty">Not blocked by any task.</p>
            )}
          </div>

          {/* Blocking */}
          {blockingCount > 0 && (
            <div className="deps-section">
              <div className="deps-section-title">
                Blocking ({blockingCount})
              </div>
              <div className="deps-list">
                {deps.blocking.map((t) => (
                  <div key={t.id} className="deps-item">
                    <div
                      className="task-status-dot"
                      style={{ background: statusColor[t.status] }}
                    />
                    <span className="deps-item-title">{t.title}</span>
                    <span
                      className="badge"
                      style={{
                        background: statusColor[t.status] + "22",
                        color: statusColor[t.status],
                        fontSize: "10px",
                      }}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add dependency */}
          <div className="deps-add-section">
            <div className="deps-section-title">Add Blocker</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              style={{
                fontSize: "12px",
                padding: "6px 10px",
                marginBottom: "6px",
              }}
            />
            {search && searchResults.length > 0 && (
              <div className="deps-search-results">
                {searchResults.map((t) => (
                  <div
                    key={t.id}
                    className="deps-search-item"
                    onClick={() => handleAdd(t.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleAdd(t.id))?.(e); } }}
                  >
                    <div
                      className="task-status-dot"
                      style={{ background: statusColor[t.status] }}
                    />
                    <span style={{ fontSize: "12px", flex: 1 }}>{t.title}</span>
                    <span
                      className="badge"
                      style={{
                        background: statusColor[t.status] + "22",
                        color: statusColor[t.status],
                        fontSize: "10px",
                      }}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {search && searchResults.length === 0 && (
              <p style={{ fontSize: "11px", color: "#aaa" }}>No tasks found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
