/**
 * CommandPalette — Cmd+K / Ctrl+K global command palette.
 * Fuzzy searches pages, tasks, projects, and actions.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getTasks } from "../api/tasks";
import { getProjects } from "../api/projects";

// ── Static commands ───────────────────────────────────────────
const PAGES = [
  { id: "go-dashboard",   icon: "📊", label: "Go to Dashboard",        path: "/",               group: "Navigate" },
  { id: "go-tasks",       icon: "✅", label: "Go to Tasks",            path: "/tasks",           group: "Navigate" },
  { id: "go-projects",    icon: "📁", label: "Go to Projects",         path: "/projects",        group: "Navigate" },
  { id: "go-goals",       icon: "🎯", label: "Go to Goals",            path: "/goals",           group: "Navigate" },
  { id: "go-kanban",      icon: "🗂️", label: "Go to Kanban",           path: "/kanban",          group: "Navigate" },
  { id: "go-calendar",    icon: "📅", label: "Go to Calendar",         path: "/calendar",        group: "Navigate" },
  { id: "go-gantt",       icon: "📅", label: "Go to Gantt Chart",      path: "/gantt",           group: "Navigate" },
  { id: "go-analytics",   icon: "📈", label: "Go to Analytics",        path: "/analytics",       group: "Navigate" },
  { id: "go-reports",     icon: "📄", label: "Go to Reports",          path: "/reports",         group: "Navigate" },
  { id: "go-team",        icon: "👥", label: "Go to Team",             path: "/team",            group: "Navigate" },
  { id: "go-activity",    icon: "📋", label: "Go to Activity Log",     path: "/activity",        group: "Navigate" },
  { id: "go-time",        icon: "⏱️", label: "Go to Time & Billing",   path: "/time-tracking",   group: "Navigate" },
  { id: "go-developer",   icon: "⚙️", label: "Go to Developer Portal", path: "/developer",       group: "Navigate" },
  { id: "go-ws-settings", icon: "🏢", label: "Workspace Settings",     path: "/workspace-settings", group: "Navigate" },
  { id: "go-profile",     icon: "👤", label: "Profile & Security",     path: "/profile",         group: "Navigate" },
  { id: "go-search",      icon: "🔍", label: "Search",                 path: "/search",          group: "Navigate" },
];

const ACTIONS = [
  { id: "new-task",    icon: "✅", label: "Create New Task",    action: "new-task",    group: "Actions" },
  { id: "new-project", icon: "📁", label: "Create New Project", action: "new-project", group: "Actions" },
  { id: "new-goal",    icon: "🎯", label: "Create New Goal",    action: "new-goal",    group: "Actions" },
];

// ── Fuzzy match ───────────────────────────────────────────────
function fuzzy(str, query) {
  if (!query) return true;
  str = str.toLowerCase();
  query = query.toLowerCase();
  let si = 0;
  for (let i = 0; i < query.length; i++) {
    si = str.indexOf(query[i], si);
    if (si === -1) return false;
    si++;
  }
  return true;
}

function highlight(text, query) {
  if (!query) return text;
  const parts = [];
  let last = 0;
  const lower = text.toLowerCase();
  const ql    = query.toLowerCase();
  let si = 0;
  for (let i = 0; i < ql.length; i++) {
    const idx = lower.indexOf(ql[i], si);
    if (idx === -1) break;
    if (idx > last) parts.push(<span key={`t${i}`}>{text.slice(last, idx)}</span>);
    parts.push(<mark key={`m${i}`} className="cp-highlight">{text[idx]}</mark>);
    last = idx + 1;
    si   = idx + 1;
  }
  if (last < text.length) parts.push(<span key="end">{text.slice(last)}</span>);
  return parts;
}

export default function CommandPalette({ onClose, onAction }) {
  const navigate  = useNavigate();
  const inputRef  = useRef(null);
  const listRef   = useRef(null);
  const [query, setQuery]     = useState("");
  const [tasks, setTasks]     = useState([]);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(0);

  // Load tasks + projects for search
  useEffect(() => {
    getTasks().then(r => setTasks(r.data || [])).catch(() => {});
    getProjects().then(r => setProjects(r.data || [])).catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Build result list
  const results = (() => {
    const all = [
      ...ACTIONS,
      ...PAGES,
      ...tasks.slice(0, 100).map(t => ({
        id: `task-${t.id}`, icon: t.status === "DONE" ? "✅" : t.status === "IN_PROGRESS" ? "🔄" : "⬜",
        label: t.title,
        sub:   t.status?.replace("_"," "),
        path:  `/tasks?highlight=${t.id}`,
        group: "Tasks",
      })),
      ...projects.map(p => ({
        id: `proj-${p.id}`, icon: "📁",
        label: p.name,
        sub:   p.status,
        path:  `/projects?highlight=${p.id}`,
        group: "Projects",
      })),
    ];
    if (!query) return all.filter(r => r.group === "Actions" || r.group === "Navigate").slice(0, 12);
    return all.filter(r => fuzzy(r.label, query) || fuzzy(r.group || "", query)).slice(0, 12);
  })();

  // Keyboard navigation
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets selection when the search query changes
    setSelected(0);
  }, [query]);

  const execute = useCallback((item) => {
    if (item.action) { onAction?.(item.action); onClose(); return; }
    if (item.path)   { navigate(item.path); onClose(); }
  }, [onAction, onClose, navigate]);

  const handleKey = useCallback((e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === "Escape")    { onClose(); }
    if (e.key === "Enter" && results[selected]) { execute(results[selected]); }
  }, [results, selected, execute, onClose]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selected];
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Group items
  const groups = results.reduce((acc, item) => {
    const g = item.group || "Other";
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  return (
    <div className="cp-overlay" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (onClose)?.(e); } }}>
      <div className="cp-modal" onClick={e => e.stopPropagation()} onKeyDown={handleKey} role="presentation">
        <div className="cp-input-wrap">
          <span className="cp-search-icon">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, tasks, projects… or type a command"
          />
          {query && (
            <button className="cp-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>✕</button>
          )}
        </div>

        <div className="cp-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="cp-empty">No results for "{query}"</div>
          ) : (
            Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} className="cp-group">
                <div className="cp-group-label">{groupName}</div>
                {items.map((item) => {
                  const idx = results.indexOf(item);
                  return (
                    <div
                      key={item.id}
                      className={`cp-item ${idx === selected ? "cp-item-selected" : ""}`}
                      onClick={() => execute(item)}
                      onMouseEnter={() => setSelected(idx)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => execute(item))?.(e); } }}
                    >
                      <span className="cp-item-icon">{item.icon}</span>
                      <div className="cp-item-body">
                        <span className="cp-item-label">{highlight(item.label, query)}</span>
                        {item.sub && <span className="cp-item-sub">{item.sub}</span>}
                      </div>
                      {item.group === "Navigate" && <span className="cp-item-hint">↵ Go</span>}
                      {item.group === "Actions"  && <span className="cp-item-hint cp-item-hint-action">↵ Run</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
          <span><kbd>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
