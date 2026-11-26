import { respondApproval } from "../api/automations";
import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNotifications, getUnreadCount,
  markRead, markAllRead,
  deleteNotification, deleteAllNotifications,
} from "../api/notifications";
import client from "../api/client";
import { useToast } from "./ToastContext";
import { useConfirm } from "../hooks/useConfirm";
import { awayFromApp, desktopAllowed, notificationUrl, showDesktopNotification } from "../utils/desktopNotify";
import { getPushState } from "../utils/push";
import { AlarmClock as IcAlarmClock, AtSign as IcAtSign, Bell as IcBell, CheckCheck as IcCheckCheck, CircleCheck as IcCircleCheck, CircleX as IcCircleX, ClipboardList as IcClipboardList, Folder as IcFolder, Footprints as IcFootprints, Info as IcInfo, Mail as IcMail, Pin as IcPin, PinOff as IcPinOff, Target as IcTarget, Trash2 as IcTrash2, TriangleAlert as IcTriangleAlert, User as IcUser, X as IcX, Zap as IcZap } from "lucide-react";
import { statusText } from "../utils/statusText";
import "../styles/notification-center.css";

// Tone of the icon tile. Only warnings and errors carry colour; everything else stays neutral.
const TYPE_TONE = { INFO:"neutral", SUCCESS:"neutral", WARNING:"warning", ERROR:"danger" };

/** Event-type titles read in sentence case: "Task Status Changed" -> "Task status changed".
 *  Only short, all-Title-Case titles are touched, so names inside longer titles keep their capitals. */
const titleText = (t = "") => {
  const words = t.trim().split(/\s+/);
  if (words.length > 4 || !words.every(w => /^[A-Z][a-z]+$/.test(w))) return t;
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ");
};
/** Enum values inside a message read as words: "IN_PROGRESS" -> "In progress" */
const readable = (m = "") => m.replace(/\b[A-Z]{2,}(?:_[A-Z]+)+\b|\b(?:TODO|DONE|BLOCKED|CANCELLED|OPEN|CLOSED)\b/g, w => statusText(w));
/** "Today 14:02", "Nov 15, 21:13", or with the year when it is not this year */
const whenText = (iso) => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const date = d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month:"short", day:"numeric" } : { month:"short", day:"numeric", year:"numeric" });
  return `${date}, ${time}`;
};
/** Day heading for the list: Today / Yesterday / Earlier. */
const dayBucket = (iso) => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "Earlier";
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : "Earlier";
};
/** Things that want a decision or an answer from the person: approvals, assignments, mentions, high priority, warnings. */
const needsAction = (n) => !n.read && (n.entityType === "APPROVAL" || n.category === "ASSIGNMENT" || n.category === "MENTION" || n.priority === "HIGH" || n.type === "WARNING" || n.type === "ERROR");
const OPEN_LABEL = { TASK: "Open task", PROJECT: "Open project", GOAL: "Open goal" };

const TYPE_ICON  = { INFO:<IcInfo size={16} strokeWidth={1.5} aria-hidden="true" />, WARNING:<IcTriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />, SUCCESS:<IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" />, ERROR:<IcCircleX size={16} strokeWidth={1.5} aria-hidden="true" /> };
const ENTITY_ICON= { TASK:<IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" />, PROJECT:<IcFolder size={16} strokeWidth={1.5} aria-hidden="true" />, GOAL:<IcTarget size={16} strokeWidth={1.5} aria-hidden="true" />, SPRINT:<IcFootprints size={16} strokeWidth={1.5} aria-hidden="true" />, AUTOMATION:<IcZap size={16} strokeWidth={1.5} aria-hidden="true" />, APPROVAL:<IcClipboardList size={16} strokeWidth={1.5} aria-hidden="true" /> };

const CATEGORY_META = {
  ASSIGNMENT: { label:"Assignments", icon:<IcUser size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#5B5FEE" },
  MENTION:    { label:"Mentions",    icon:<IcAtSign size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#ec4899" },
  APPROVAL:   { label:"Approvals",   icon:<IcCircleCheck size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#1E8E5A" },
  GOAL:       { label:"Goals",       icon:<IcTarget size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#7C5CBF" },
  RISK:       { label:"Risks",       icon:<IcTriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#C17D22" },
  SYSTEM:     { label:"System",      icon:<IcBell size={16} strokeWidth={1.5} aria-hidden="true" />, color:"#64748b" },
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

export default function NotificationBell() {
  const { show: toast } = useToast();
  const confirm = useConfirm();
  const [open,          setOpen]          = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [activeGroup,   setActiveGroup]   = useState("ALL");
  const [selectedIds,   setSelectedIds]   = useState([]);
  const [sortBy,        setSortBy]        = useState("newest");  // newest | priority | type
  const [snoozeMenuId,  setSnoozeMenuId]  = useState(null);
  const [ring,          setRing]          = useState(false);   // the bell shakes for a few seconds when something new arrives
  const ringTimer = useRef(null);
  const ref      = useRef(null);
  const navigate = useNavigate();

  // Pop-ups on the desktop for notifications that arrive while the person is away from Prowosma (another window, or minimised).
  const seenRef = useRef(null);          // ids already known; null until the first look, so old notifications never pop up
  const lastCountRef = useRef(null);
  const pushOnRef = useRef(false);       // when the server pushes this device, its own categories are not repeated here
  useEffect(() => { getPushState().then((st) => { pushOnRef.current = !!st.subscribed; }).catch(() => {}); }, []);

  const popUpNew = useCallback(async () => {
    if (!desktopAllowed()) return;
    try {
      const list = (await getNotifications()).data || [];
      if (seenRef.current === null) { seenRef.current = new Set(list.map((n) => n.id)); return; }
      const fresh = list.filter((n) => !n.read && !seenRef.current.has(n.id));
      list.forEach((n) => seenRef.current.add(n.id));
      if (!awayFromApp()) return;
      const wanted = fresh.filter((n) => !(pushOnRef.current && (n.category === "ASSIGNMENT" || n.category === "MENTION")));
      if (wanted.length > 3) await showDesktopNotification({ title: `${wanted.length} new notifications`, body: wanted.slice(0, 3).map((n) => n.title).join(" · "), url: "/", tag: "prowosma-many" });
      else for (const n of wanted) await showDesktopNotification({ title: n.title || "Prowosma", body: n.message || "", url: notificationUrl(n), tag: `n-${n.id}` });
    } catch { /* a missed pop-up is not worth an error */ }
  }, []);

  const loadCount = useCallback(async () => {
    try {
      const r = await getUnreadCount();
      setUnreadCount(r.data.count);
      const before = lastCountRef.current;
      lastCountRef.current = r.data.count;
      if (before !== null && r.data.count > before) {
        setRing(true);
        clearTimeout(ringTimer.current);
        ringTimer.current = setTimeout(() => setRing(false), 3500);
      }
      if (before === null || r.data.count > before) popUpNew();    // first look: remember what is there; later: something new arrived
    } catch { /* background poll — fail silently, badge just won't update this cycle */ }
  }, [popUpNew]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard load-on-mount pattern; loadCount sets state after its own async call
    loadCount();
    const interval = setInterval(loadCount, 15000);
    return () => clearInterval(interval);
  }, [loadCount]);

  useEffect(() => () => clearTimeout(ringTimer.current), []);

  // The number is also in the browser tab, so it is seen when Prowosma is in the background.
  const baseTitle = useRef(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unreadCount > 0 ? `(${unreadCount > 99 ? "99+" : unreadCount}) ${baseTitle.current}` : baseTitle.current;
    return () => { if (baseTitle.current !== null) document.title = baseTitle.current; };
  }, [unreadCount]);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const notifRes = await getNotifications();
        const list = notifRes.data || [];
        setNotifications(list);
        // Opening the inbox starts with what needs the person, when there is anything.
        setActiveGroup(list.some(needsAction) ? "ACTION" : "ALL");
      } catch { /* panel open — user can retry by reopening it */ }
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
      if (activeGroup === "ACTION")  return needsAction(n);
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
    // eslint-disable-next-line react-hooks/purity -- click-triggered handler, not render
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

  // "Open" button on a row: where this notification points, if it points anywhere.
  const destination = (n) => { const u = notificationUrl(n); return u && u !== "/" ? u : null; };
  const openIt = async (n) => {
    if (!n.read) await handleMarkRead(n.id);
    const u = destination(n);
    if (u) { navigate(u); setOpen(false); }
  };

  const toggleSelect = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const groups = [
    { key:"ACTION",     label:"Needs action", count: notifications.filter(needsAction).length },
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
      <button type="button" className={`notif-bell-btn nc-bell${unreadCount > 0 ? " has-unread" : ""}${ring ? " is-ringing" : ""}`} onClick={() => setOpen(o => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} aria-expanded={open}>
        <IcBell size={20} strokeWidth={2} aria-hidden="true" className="nc-bell-icon" />
        {unreadCount > 0 && (
          <span className="nc-bell-count" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel notif-inbox-panel nb-panel" role="dialog" aria-label="Notifications">
          {/* Header */}
          <div className="nb-head">
            <div className="nb-title">
              Inbox
              {unreadCount > 0 && <span className="nb-title-count">{unreadCount} new</span>}
            </div>
            <div className="nb-head-actions">
              <select className="nb-sort" aria-label="Sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="newest">Newest</option>
                <option value="priority">Priority</option>
              </select>
              {unreadCount > 0 && (
                <button type="button" className="nb-link" onClick={handleMarkAllRead}>
                  <IcCheckCheck size={14} strokeWidth={1.5} aria-hidden="true" /> Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button type="button" className="nb-icon-btn" title="Clear all" aria-label="Clear all notifications"
                  onClick={async () => { if(await confirm({ title: "Clear all notifications?", danger: true, confirmText: "Clear all" })) { await deleteAllNotifications(); setNotifications([]); setUnreadCount(0); } }}>
                  <IcTrash2 size={15} strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Group tabs */}
          <div className="nb-tabs" role="tablist" aria-label="Filter notifications">
            {groups.map(g => (
              <button key={g.key} type="button" role="tab" aria-selected={activeGroup === g.key}
                className={`nb-tab${activeGroup === g.key ? " is-active" : ""}`}
                onClick={() => setActiveGroup(g.key)}>
                {g.label}
                {g.count > 0 && <span className="nb-tab-count">{g.count}</span>}
              </button>
            ))}
          </div>

          {/* Bulk actions */}
          {selectedIds.length > 0 && (
            <div className="nb-bulk">
              <span>{selectedIds.length} selected</span>
              <button type="button" className="nb-link" onClick={handleBulkRead}>Mark read</button>
              <button type="button" className="nb-link nb-link--quiet" onClick={() => setSelectedIds([])}>Clear selection</button>
            </div>
          )}

          {/* Notification list */}
          <div className={`nb-list${selectedIds.length ? " is-selecting" : ""}`}>
            {filtered.length > 0 ? filtered.map((n, i) => {
              const bucket = sortBy === "newest" && activeGroup !== "PINNED" ? dayBucket(n.createdAt) : null;
              const showDay = bucket && (i === 0 || bucket !== dayBucket(filtered[i - 1].createdAt));
              const isSelected = selectedIds.includes(n.id);
              const tone = TYPE_TONE[n.type] || "neutral";
              return (
                <Fragment key={n.id}>
                {showDay && <div className="nc-day" role="presentation">{bucket}</div>}
                <div
                  className={`nb-item${!n.read ? " is-unread" : ""}${isSelected ? " is-selected" : ""}`}
                  onClick={() => handleClick(n)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleClick(n); } }}>

                  {/* Icon tile; becomes a checkbox on hover and while selecting */}
                  <div className="nb-lead">
                    <span className={`nb-icon nb-icon--${tone}`} aria-hidden="true">
                      {ENTITY_ICON[n.entityType] || TYPE_ICON[n.type] || <IcBell size={16} strokeWidth={1.5} />}
                    </span>
                    <input type="checkbox" className="nb-check" aria-label={`Select ${n.title}`}
                      checked={isSelected}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggleSelect(n.id)} />
                  </div>

                  <div className="nb-body">
                    <div className="nb-item-title">
                      <span className="nb-item-title-text">{titleText(n.title)}</span>
                      {n.pinned && <IcPin className="nb-pin" size={13} strokeWidth={1.5} aria-label="Pinned" />}
                      {n.priority === "HIGH" && <span className="nb-high">High</span>}
                    </div>
                    {n.message && <div className="nb-item-msg">{readable(n.message)}</div>}
                    {n.entityType === "APPROVAL" && n.entityId && (
                      <div className="nb-approval">
                        <button type="button" className="nb-btn nb-btn--primary"
                          onClick={async e => {
                            e.stopPropagation();
                            try { await respondApproval(n.entityId, { action:"APPROVED", comment:"Approved via notification" }); }
                            catch { toast("Failed to approve", "error"); }
                          }}>Approve</button>
                        <button type="button" className="nb-btn"
                          onClick={async e => {
                            e.stopPropagation();
                            try { await respondApproval(n.entityId, { action:"REJECTED", comment:"Rejected via notification" }); }
                            catch { toast("Failed to reject", "error"); }
                          }}>Reject</button>
                      </div>
                    )}
                    {!n.read && n.entityType !== "APPROVAL" && (
                      <div className="nc-row-actions" onClick={e => e.stopPropagation()} role="presentation">
                        {destination(n) && <button type="button" className="nb-btn nb-btn--primary" onClick={() => openIt(n)}>{OPEN_LABEL[n.entityType] || "Open"}</button>}
                        <button type="button" className="nb-btn" onClick={() => handleMarkRead(n.id)}>Mark read</button>
                      </div>
                    )}
                    <div className="nb-meta">
                      {!n.read && <span className="nb-dot" aria-label="Unread" />}
                      <time dateTime={n.createdAt}>{whenText(n.createdAt)}</time>
                    </div>
                  </div>

                  {/* Actions: one horizontal row, shown on hover and focus */}
                  <div className="nb-actions" onClick={e => e.stopPropagation()} role="presentation">
                    <button type="button" className="nb-icon-btn" title={n.pinned ? "Unpin" : "Pin"} aria-label={n.pinned ? "Unpin" : "Pin"}
                      onClick={() => handlePin(n.id)}>{n.pinned ? <IcPinOff size={15} strokeWidth={1.5} aria-hidden="true" /> : <IcPin size={15} strokeWidth={1.5} aria-hidden="true" />}</button>
                    <div className="nb-snooze">
                      <button type="button" className="nb-icon-btn" title="Snooze" aria-label="Snooze" aria-expanded={snoozeMenuId === n.id}
                        onClick={() => setSnoozeMenuId(id => id === n.id ? null : n.id)}><IcAlarmClock size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                      {snoozeMenuId === n.id && (
                        <div className="nb-menu" role="menu">
                          {SNOOZE_OPTIONS.map(opt => (
                            <button key={opt.hours} type="button" role="menuitem" onClick={() => handleSnooze(n.id, opt.hours)}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" className="nb-icon-btn" title="Delete" aria-label="Delete"
                      onClick={() => handleDelete(n.id)}><IcX size={15} strokeWidth={1.5} aria-hidden="true" /></button>
                  </div>
                </div>
                </Fragment>
              );
            }) : (
              <div className="nb-empty">
                <span className="nb-icon nb-icon--neutral" aria-hidden="true">
                  {activeGroup === "PINNED" ? <IcPin size={16} strokeWidth={1.5} /> : activeGroup === "UNREAD" ? <IcMail size={16} strokeWidth={1.5} /> : <IcBell size={16} strokeWidth={1.5} />}
                </span>
                <p>{activeGroup === "UNREAD" || activeGroup === "ACTION" ? "All caught up" : "Nothing here"}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
