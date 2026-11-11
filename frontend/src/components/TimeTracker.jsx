import { Timer, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { addTimeLog, deleteTimeLog } from "../api/tasks";

function formatTime(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function TimeTracker({ task, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [description, setDescription] = useState("");
  const [tracking, setTracking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const ref = useRef(null);

  const totalMinutes =
    task.timeLogs?.reduce((acc, t) => acc + t.minutes, 0) || 0;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setTracking(true);
    setElapsed(0);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
  };

  const stopTimer = async () => {
    clearInterval(timerRef.current);
    setTracking(false);
    const mins = Math.max(1, Math.round(elapsed / 60));
    await addTimeLog(task.id, {
      minutes: mins,
      description: description || "Timer session",
    });
    setElapsed(0);
    setDescription("");
    onRefresh();
  };

  const handleManualAdd = async () => {
    const mins = parseInt(minutes);
    if (!mins || mins <= 0) return;
    await addTimeLog(task.id, {
      minutes: mins,
      description: description || "Manual entry",
    });
    setMinutes("");
    setDescription("");
    onRefresh();
  };

  const handleDelete = async (logId) => {
    if (window.confirm("Delete this time log?")) {
      await deleteTimeLog(task.id, logId);
      onRefresh();
    }
  };

  return (
    <div className="time-tracker-wrapper" ref={ref}>
      <button
        className="time-tracker-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Timer size={13} aria-hidden="true" />
        {totalMinutes > 0 ? `Time · ${formatTime(totalMinutes)}` : "Time"}
        <ChevronDown size={12} aria-hidden="true" className={open ? "is-open" : undefined} />
      </button>

      {open && (
        <div
          className="time-tracker-panel"
          onClick={(e) => e.stopPropagation()} role="presentation"
        >
          <div className="task-comments-header">Time Tracking</div>

          {/* Total */}
          <div className="time-tracker-total">
            <span>Total logged:</span>
            <span style={{ fontWeight: 700, color: "#6366f1" }}>
              {formatTime(totalMinutes)}
            </span>
          </div>

          {/* Timer */}
          <div className="time-tracker-timer">
            {tracking ? (
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <span className="time-tracker-elapsed">
                  ⏱️{" "}
                  {Math.floor(elapsed / 3600)
                    .toString()
                    .padStart(2, "0")}
                  :
                  {Math.floor((elapsed % 3600) / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(elapsed % 60).toString().padStart(2, "0")}
                </span>
                <button
                  className="btn-primary"
                  style={{
                    fontSize: "11px",
                    padding: "4px 10px",
                    background: "#ef4444",
                  }}
                  onClick={stopTimer}
                >
                  ⏹ Stop & Save
                </button>
              </div>
            ) : (
              <button
                className="btn-secondary"
                style={{ fontSize: "11px", padding: "4px 10px" }}
                onClick={startTimer}
              >
                ▶ Start Timer
              </button>
            )}
          </div>

          {/* Manual entry */}
          <div className="time-tracker-manual">
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#aaa",
                marginBottom: "6px",
                textTransform: "uppercase",
              }}
            >
              Manual Entry
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              style={{
                fontSize: "12px",
                padding: "5px 8px",
                marginBottom: "6px",
              }}
            />
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="Minutes"
                type="number"
                min="1"
                style={{ fontSize: "12px", padding: "5px 8px", width: "80px" }}
              />
              <button
                className="btn-primary"
                style={{ fontSize: "11px", padding: "5px 10px" }}
                onClick={handleManualAdd}
              >
                + Log
              </button>
            </div>
          </div>

          {/* Log history */}
          {task.timeLogs?.length > 0 && (
            <div className="time-tracker-logs">
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#aaa",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                }}
              >
                History
              </div>
              {task.timeLogs.map((log) => (
                <div key={log.id} className="time-log-item">
                  <div style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#6366f1",
                      }}
                    >
                      {formatTime(log.minutes)}
                    </span>
                    {log.description && (
                      <span
                        style={{
                          fontSize: "11px",
                          color: "#888",
                          marginLeft: "8px",
                        }}
                      >
                        {log.description}
                      </span>
                    )}
                    <div style={{ fontSize: "10px", color: "#aaa" }}>
                      {new Date(log.loggedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    style={{ fontSize: "11px" }}
                    onClick={() => handleDelete(log.id)}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
