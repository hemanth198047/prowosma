import { useState, useEffect, useRef, useCallback } from "react";
import { unwrapList } from "../api/client";
import { useNavigate } from "react-router-dom";
import {
  getNotifications, getUnreadCount,
  markRead, markAllRead,
  deleteNotification, deleteAllNotifications,
} from "../api/notifications";
import client from "../api/client";

const TYPE_COLOR = { INFO:"#6366f1", WARNING:"#f59e0b", SUCCESS:"#10b981", ERROR:"#ef4444" };
const TYPE_ICON  = { INFO:"ℹ️", WARNING:"⚠️", SUCCESS:"✅", ERROR:"❌" };
const ENTITY_ICON= { TASK:"✅", PROJECT:"📁", GOAL:"🎯", SPRINT:"🏃", AUTOMATION:"⚡", APPROVAL:"📋" };

const CATEGORY_META = {
  ASSIGNMENT: { label:"Assignments", icon:"👤", color:"#6366f1" },
  MENTION:    { label:"Mentions",    icon:"@",  color:"#ec4899" },
  APPROVAL:   { label:"Approvals",   icon:"✅", color:"#10b981" },
  GOAL:       { label:"Goals",       icon:"🎯", color:"#8b5cf6" },
  RISK:       { label:"Risks",       icon:"⚠️", color:"#f59e0b" },
  SYSTEM:     { label:"System",      icon:"🔔", color:"#6b7280" },
};

const SNOOZE_OPTIONS = [
  { label:"1 hour",     hours:1  },
  { label:"4 hours",    hours:4  },
  { label:"Tomorrow",   hours:24 },
  { label:"Next week",  hours:168},
];

// Notification api helpers using client directly
const snoozeNotification = (id, until) => client.patch(`/notifications/${id}/snooze`, { until });
const pinNotification    = (id)         => client.patch(`/notifications/${id}/pin`);
const bulkMarkRead       = (ids)        => client.patch("/notifications/bulk-read", { ids });
const getInbox           = ()           => client.get("/notifications/inbox");

export default function NotificationBell() {
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [inbox,         setInbox]         = useState(null);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [activeGroup,   setActiveGroup]   = useState("ALL");
  const [selectedIds,   setSelectedIds]   = useState([]);
  const [sortBy,        setSortBy]        = useState("newest");  // newest | priority | type
  const [snoozeMenuId,  setSnoozeMenuId]  = useState(null);
  const ref      = useRef(null);
  const navigate = useNavigate();

  const loadCount = useCallback(async () => {
    try { const r = await getUnreadCount(); setUnreadCount(r.data.count); } catch {}
  }, []);

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, [loadCount]);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const [notifRes, inboxRes] = await Promise.all([getNotifications(), getInbox()]);
        setNotifications(unwrapList(notifRes));
        setInbox(unwrapList(inboxRes));
      } catch {}
    };
    load();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Filter + sort notifications
  const filtered = notifications
    .filter(n => {
      if (activeGroup === "ALL")     return true;
      if (activeGroup === "UNREAD")  return !n.read;
      if (activeGroup === "PINNED")  return n.pinned;
      return n.category === activeGroup;
    })
    .sort((a, b) => {
      if (sortBy === "priority") {
        const p = { HIGH:0, NORMAL:1, LOW:2 };
        return (p[a.priority]||1) - (p[b.priority]||1);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

  const handleMarkRead = async (id) => {
    await markRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? {...n, read:true} : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    setNotifications(prev => prev.map(n => ({...n, read:true})));
    setUnreadCount(0);
  };

  const handleDelete = async (id) => {
    const n = notifications.find(n => n.id === id);
    await deleteNotification(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (n && !n.read) setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleBulkRead = async () => {
    if (!selectedIds.length) return;
    await bulkMarkRead(selectedIds);
    setNotifications(prev => prev.map(n => selectedIds.includes(n.id) ? {...n, read:true} : n));
    setUnreadCount(prev => Math.max(0, prev - selectedIds.filter(id => !notifications.find(n=>n.id===id)?.read).length));
    setSelectedIds([]);
  };

  const handleSnooze = async (id, hours) => {
    const until = new Date(Date.now() + hours * 3600000).toISOString().slice(0,19);
    await snoozeNotification(id, until);
    setNotifications(prev => prev.filter(n => n.id !== id));
    setSnoozeMenuId(null);
  };

  const handlePin = async (id) => {
    await pinNotification(id);
    setNotifications(prev => prev.map(n => n.id === id ? {...n, pinned:!n.pinned} : n));
  };

  const handleClick = async (n) => {
    if (!n.read) await handleMarkRead(n.id);
    const routes = { TASK:`/tasks?highlight=${n.entityId}`, PROJECT:`/projects?highlight=${n.entityId}`, GOAL:`/goals?highlight=${n.entityId}` };
    if (routes[n.entityType]) { navigate(routes[n.entityType]); setOpen(false); }
  };

  const toggleSelect = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const groups = [
    { key:"ALL",        label:"All",         count: notifications.length },
    { key:"UNREAD",     label:"Unread",      count: notifications.filter(n=>!n.read).length },
    { key:"PINNED",     label:"Pinned",      count: notifications.filter(n=>n.pinned).length },
    ...Object.entries(CATEGORY_META).map(([k,m]) => ({
      key:k, label:m.label,
      count: notifications.filter(n=>n.category===k).length,
    })).filter(g => g.count > 0),
  ];

  return (
    <div className="notif-bell-wrapper" ref={ref}>
      <button className="notif-bell-btn" onClick={() => setOpen(o => !o)}>
        🔔
        {unreadCount > 0 && (
          <span className="notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel notif-inbox-panel">
          {/* Header */}
          <div className="notif-panel-header">
            <div className="notif-inbox-title">
              📥 Inbox
              {unreadCount > 0 && <span className="notif-unread-badge">{unreadCount} new</span>}
            </div>
            <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
              <select className="notif-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="newest">Newest</option>
                <option value="priority">Priority</option>
              </select>
              {unreadCount > 0 && (
                <button className="btn-link" style={{ fontSize:"11px" }} onClick={handleMarkAllRead}>
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button className="btn-link" style={{ fontSize:"11px", color:"#ef4444" }}
                  onClick={async () => { if(window.confirm("Clear all?")) { await deleteAllNotifications(); setNotifications([]); setUnreadCount(0); } }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Group tabs */}
          <div className="notif-group-tabs">
            {groups.map(g => (
              <button key={g.key}
                className={`notif-group-tab${activeGroup === g.key ? " active" : ""}`}
                onClick={() => setActiveGroup(g.key)}>
                {g.label}
                {g.count > 0 && <span className="notif-group-count">{g.count}</span>}
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          {selectedIds.length > 0 && (
            <div className="notif-bulk-bar">
              <span>{selectedIds.length} selected</span>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"3px 8px" }}
                onClick={handleBulkRead}>Mark read</button>
              <button className="btn-secondary" style={{ fontSize:"11px", padding:"3px 8px" }}
                onClick={() => setSelectedIds([])}>Clear selection</button>
            </div>
          )}

          {/* Notification list */}
          <div className="notif-list">
            {filtered.length > 0 ? filtered.map(n => {
              const catMeta = CATEGORY_META[n.category] || CATEGORY_META.SYSTEM;
              const isSelected = selectedIds.includes(n.id);
              return (
                <div key={n.id}
                  className={`notif-item${!n.read ? " unread" : ""}${n.pinned ? " pinned" : ""}${isSelected ? " selected" : ""}`}
                  onClick={() => handleClick(n)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (() => handleClick(n))?.(e); } }}>

                  {/* Checkbox for bulk */}
                  <input type="checkbox" className="notif-check"
                    checked={isSelected}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleSelect(n.id)} />

                  <div className="notif-item-icon"
                    style={{ background: TYPE_COLOR[n.type]+"22", color: TYPE_COLOR[n.type] }}>
                    {ENTITY_ICON[n.entityType] || TYPE_ICON[n.type]}
                  </div>

                  <div className="notif-item-content">
                    <div className="notif-item-title">
                      {n.pinned && <span className="notif-pin-icon">📌</span>}
                      {n.priority === "HIGH" && <span className="notif-high-badge">HIGH</span>}
                      <span className="notif-cat-chip" style={{ background:`${catMeta.color}18`, color:catMeta.color }}>
                        {catMeta.icon}
                      </span>
                      {n.title}
                    </div>
                    <div className="notif-item-message">{n.message}</div>
                    <div className="notif-item-time">
                      {new Date(n.createdAt).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="notif-item-actions" onClick={e => e.stopPropagation()} role="presentation">
                    {!n.read && <div className="notif-unread-dot" />}
                    <button className="notif-action-btn" title={n.pinned ? "Unpin" : "Pin"}
                      onClick={() => handlePin(n.id)}>{n.pinned ? "📌" : "📍"}</button>
                    <div className="notif-snooze-wrap">
                      <button className="notif-action-btn" title="Snooze"
                        onClick={() => setSnoozeMenuId(id => id === n.id ? null : n.id)}>💤</button>
                      {snoozeMenuId === n.id && (
                        <div className="notif-snooze-menu">
                          {SNOOZE_OPTIONS.map(opt => (
                            <button key={opt.hours} onClick={() => handleSnooze(n.id, opt.hours)}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="notif-action-btn" title="Delete"
                      onClick={() => handleDelete(n.id)}>✕</button>
                  </div>
                </div>
              );
            }) : (
              <div className="notif-empty">
                <div style={{ fontSize:"32px", marginBottom:"8px" }}>
                  {activeGroup === "PINNED" ? "📌" : activeGroup === "UNREAD" ? "✉️" : "🔔"}
                </div>
                <p style={{ color:"#888", fontSize:"13px" }}>
                  {activeGroup === "UNREAD" ? "All caught up!" : "Nothing here"}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
