import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { globalSearch } from "../api/search";
import PageHeader from "../components/PageHeader";

import "../styles/pages/search.css";
export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({
    projects: [],
    tasks: [],
    goals: [],
  });
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    try {
      const res = await globalSearch(query.trim());
      const data = res?.data || {};
      setResults({
        projects: Array.isArray(data.projects) ? data.projects : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        goals: Array.isArray(data.goals) ? data.goals : [],
      });
      setSearched(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClearContent = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const handleClearResults = () => {
    setResults({ projects: [], tasks: [], goals: [] });
    setSearched(false);
  };

  const handleClearAll = () => {
    setQuery("");
    setResults({ projects: [], tasks: [], goals: [] });
    setSearched(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears results in response to the query dropping below the search threshold
      setResults({ projects: [], tasks: [], goals: [] });
      setSearched(false);
    }
  }, [query]);

  const total =
    results.projects.length + results.tasks.length + results.goals.length;

  const priorityColor = { LOW: "#10b981", MEDIUM: "#f59e0b", HIGH: "#ef4444" };
  const statusColor = {
    TODO: "#6366f1",
    IN_PROGRESS: "#f59e0b",
    DONE: "#10b981",
    ACTIVE: "#6366f1",
    ACHIEVED: "#10b981",
  };

  return (
    <div>
      <PageHeader
        icon="🔍"
        title="Global Search"
        description="Search across all projects, tasks and goals"
        action={
          <button className="btn-secondary" onClick={() => navigate(-1)}>
            ← Back
          </button>
        }
      />

      {/* Search Input */}
      <div className="search-input-wrapper">
        <span className="search-input-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input-large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search projects, tasks, goals..."
        />
        {query && (
          <button
            className="search-clear-btn"
            onClick={handleClearContent}
            title="Clear search text"
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
        <button
          className="btn-primary"
          onClick={handleSearch}
          disabled={query.trim().length < 2}
        >
          🔍 Search
        </button>
        {searched && (
          <button className="btn-secondary" onClick={handleClearResults}>
            🗑️ Clear Results
          </button>
        )}
        {(query || searched) && (
          <button className="btn-secondary" onClick={handleClearAll}>
            ✕ Clear All
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <p style={{ color: "#888", fontSize: "13px", marginTop: "16px" }}>
          Searching...
        </p>
      )}

      {/* Results summary */}
      {searched && !loading && (
        <p
          style={{
            color: "#888",
            fontSize: "13px",
            marginTop: "12px",
            marginBottom: "20px",
          }}
        >
          {total > 0
            ? `Found ${total} result${total > 1 ? "s" : ""} for "${query}"`
            : `No results found for "${query}"`}
        </p>
      )}

      {/* Results */}
      {searched && !loading && total > 0 && (
        <div className="search-results">
          {/* Projects */}
          {results.projects.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                📁 Projects
                <span className="search-section-count">
                  {results.projects.length}
                </span>
              </div>
              {results.projects.map((p) => (
                <div
                  key={p.id}
                  className="search-result-item"
                  onClick={() => navigate(`/tasks?projectId=${p.id}`)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => navigate(`/tasks?projectId=${p.id}`))?.(e); } }}
                >
                  <div
                    className="search-result-color"
                    style={{ background: p.color || "#6366f1" }}
                  />
                  <div className="search-result-info">
                    <div
                      className="search-result-title"
                      dangerouslySetInnerHTML={{
                        __html: highlight(p.name, query),
                      }}
                    />
                    {p.description && (
                      <div
                        className="search-result-desc"
                        dangerouslySetInnerHTML={{
                          __html: highlight(p.description, query),
                        }}
                      />
                    )}
                  </div>
                  <span className={`badge badge-${p.status?.toLowerCase()}`}>
                    {p.status}
                  </span>
                  <span className="search-result-arrow">→</span>
                </div>
              ))}
            </div>
          )}

          {/* Tasks */}
          {results.tasks.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                ✅ Tasks
                <span className="search-section-count">
                  {results.tasks.length}
                </span>
              </div>
              {results.tasks.map((t) => (
                <div
                  key={t.id}
                  className="search-result-item"
                  onClick={() =>
                    navigate(`/tasks?highlight=${t.id}&hcolor=6366f1`)
                  } role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() =>
                    navigate(`/tasks?highlight=${t.id}&hcolor=6366f1`))?.(e); } }}
                >
                  <div
                    className="task-status-dot"
                    style={{
                      background: statusColor[t.status] || "#6366f1",
                      flexShrink: 0,
                    }}
                  />
                  <div className="search-result-info">
                    <div
                      className="search-result-title"
                      dangerouslySetInnerHTML={{
                        __html: highlight(t.title, query),
                      }}
                    />
                    <div className="search-result-meta">
                      {t.dueDate && (
                        <span>
                          📅 {new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      <span
                        className="badge"
                        style={{
                          background: priorityColor[t.priority] + "22",
                          color: priorityColor[t.priority],
                        }}
                      >
                        {t.priority}
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: statusColor[t.status] + "22",
                          color: statusColor[t.status],
                        }}
                      >
                        {t.status}
                      </span>
                    </div>
                  </div>
                  <span className="search-result-arrow">→</span>
                </div>
              ))}
            </div>
          )}

          {/* Goals */}
          {results.goals.length > 0 && (
            <div className="search-section">
              <div className="search-section-header">
                🎯 Goals
                <span className="search-section-count">
                  {results.goals.length}
                </span>
              </div>
              {results.goals.map((g) => (
                <div
                  key={g.id}
                  className="search-result-item"
                  onClick={() =>
                    navigate(`/goals?highlight=${g.id}&hcolor=8b5cf6`)
                  } role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() =>
                    navigate(`/goals?highlight=${g.id}&hcolor=8b5cf6`))?.(e); } }}
                >
                  <div
                    className="task-status-dot"
                    style={{ background: "#8b5cf6", flexShrink: 0 }}
                  />
                  <div className="search-result-info">
                    <div
                      className="search-result-title"
                      dangerouslySetInnerHTML={{
                        __html: highlight(g.title, query),
                      }}
                    />
                    <div className="search-result-meta">
                      {g.targetDate && (
                        <span>
                          🎯 {new Date(g.targetDate).toLocaleDateString()}
                        </span>
                      )}
                      <span>{g.progress || 0}% complete</span>
                    </div>
                  </div>
                  <span className={`badge badge-${g.status?.toLowerCase()}`}>
                    {g.status}
                  </span>
                  <span className="search-result-arrow">→</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!searched && !loading && (
        <div className="search-empty-state">
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔍</div>
          <p
            style={{
              fontSize: "16px",
              fontWeight: 600,
              color: "#555",
              marginBottom: "8px",
            }}
          >
            Search everything
          </p>
          <p style={{ fontSize: "13px", color: "#aaa" }}>
            Type at least 2 characters to search across projects, tasks and
            goals
          </p>
        </div>
      )}
    </div>
  );
}

function highlight(text, query) {
  if (!text || !query) return text || "";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark style="background:rgba(217,119,6,0.12);color:#92400e;border-radius:2px;padding:0 2px;">$1</mark>',
  );
}
