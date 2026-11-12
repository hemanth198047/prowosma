import { apiErrorMessage } from "../../utils/apiError";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Mail, Phone, MapPin, Clock, Copy, Network, X, Building2, Briefcase, Pencil, ChevronRight, Users } from "lucide-react";
import { usePeople } from "../../context/PeopleContext";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { useToast } from "../ToastContext";
import { getPresence } from "../../api/team";
import { updateMemberOrg, updateMyContact } from "../../api/org";
import { buildTree, descendantIds, initials, localTime, managerChain } from "../../utils/org";

const CARD_W = 380;
const GAP = 10;
const ROLE_LABEL = { OWNER: "Workspace manager", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

function place(rect, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640 || !rect) return null; // phones: bottom sheet
  let left = rect.right + GAP;
  if (left + CARD_W > vw - GAP) left = rect.left - CARD_W - GAP;
  if (left < GAP) left = Math.min(Math.max(GAP, rect.left), vw - CARD_W - GAP);
  let top = rect.top - 12;
  if (top + h > vh - GAP) top = vh - h - GAP;
  if (top < GAP) top = GAP;
  return { left, top };
}

function MiniPerson({ p, onClick, current }) {
  return (
    <button type="button" className={`pc-mini${current ? " pc-mini-current" : ""}`} onClick={() => onClick(p.id)} disabled={current}>
      <span className="person-avatar-circle" style={{ width: 32, height: 32, fontSize: 12, background: p.color || "var(--brand-500)" }} aria-hidden="true">
        {initials(p.name, p.email)}
      </span>
      <span className="pc-mini-text">
        <span className="pc-mini-name">{p.name || p.email}</span>
        {p.title && <span className="pc-mini-sub">{p.title}</span>}
      </span>
      {!current && <ChevronRight size={14} className="pc-mini-chev" aria-hidden="true" />}
    </button>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="pc-row">
      <Icon size={16} aria-hidden="true" />
      <div>
        <div className="pc-row-label">{label}</div>
        <div className="pc-row-value">{children}</div>
      </div>
    </div>
  );
}

const TIME_ZONES = (() => {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"]; }
})();

function EditForm({ person, isSelf, isAdmin, people, onDone, onCancel }) {
  const toast = useToast();
  const { reload } = usePeople();
  const { byId, children } = useMemo(() => buildTree(people), [people]);
  const blocked = useMemo(() => new Set([person.id, ...descendantIds(person.id, children)]), [person.id, children]);
  const [f, setF] = useState({
    managerId: person.managerId || "", title: person.title || "", department: person.department || "",
    phone: person.phone || "", location: person.location || "", timeZone: person.timeZone || "", bio: person.bio || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setSaving(true); setError("");
    try {
      const contact = { phone: f.phone, location: f.location, timeZone: f.timeZone };
      if (isAdmin) await updateMemberOrg(person.id, { ...contact, managerId: f.managerId || null, title: f.title, department: f.department });
      if (isSelf) await updateMyContact(isAdmin ? { bio: f.bio } : { ...contact, bio: f.bio });
      await reload();
      toast.show("Profile updated", "success");
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save. Please try again."));
      setSaving(false);
    }
  };

  const managers = people.filter((p) => !blocked.has(p.id)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div className="pc-edit">
      {isAdmin && (
        <>
          <label className="pc-field">Reports to
            <select value={f.managerId} onChange={(e) => set("managerId", e.target.value)}>
              <option value="">No manager (top of the org)</option>
              {managers.map((p) => <option key={p.id} value={p.id}>{p.name || p.email}{p.title ? ` — ${p.title}` : ""}</option>)}
            </select>
          </label>
          <label className="pc-field">Job title
            <input value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior designer" />
          </label>
          <label className="pc-field">Department
            <input value={f.department} maxLength={120} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Marketing" />
          </label>
        </>
      )}
      <label className="pc-field">Work phone
        <input value={f.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" inputMode="tel" />
      </label>
      <label className="pc-field">Location
        <input value={f.location} maxLength={120} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Bengaluru office" />
      </label>
      <label className="pc-field">Time zone
        <select value={f.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
          <option value="">Not set</option>
          {TIME_ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      {isSelf && (
        <label className="pc-field">About
          <textarea value={f.bio} maxLength={1000} rows={3} onChange={(e) => set("bio", e.target.value)} placeholder="A line about what you work on" />
        </label>
      )}
      {error && <div className="pc-error" role="alert">{error}</div>}
      <div className="pc-edit-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

/** Teams-style profile card: header, then Overview / Organization / Contact. */
export default function PersonCard({ person, rect, pinned, onEnter, onLeave, onPin, onClose, onShowPerson }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { people } = usePeople();
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [online, setOnline] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const { byId, children } = useMemo(() => buildTree(people), [people]);
  const chain = useMemo(() => managerChain(person.id, byId), [person.id, byId]);
  const reports = children.get(person.id) || [];
  const manager = chain[0];
  const isSelf = !!user?.email && user.email.toLowerCase() === (person.email || "").toLowerCase();
  const canEdit = isSelf || isAdmin;

  useLayoutEffect(() => {
    if (ref.current) setPos(place(rect, ref.current.offsetHeight));
  }, [rect, tab, editing]);

  useEffect(() => {
    let alive = true;
    getPresence().then((r) => {
      if (!alive) return;
      const list = r?.data?.online || [];
      setOnline(list.some((e) => String(e).toLowerCase() === (person.email || "").toLowerCase()));
    }).catch(() => alive && setOnline(null));
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => { alive = false; clearInterval(t); };
  }, [person.email]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onDown = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return;
      if (e.target.closest?.(".person-avatar-btn")) return;
      if (e.target.closest?.('[role="alertdialog"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  useEffect(() => { if (pinned) ref.current?.focus(); }, [pinned]);

  const time = localTime(person.timeZone, now);
  const depts = [person.department, ...(person.departments || [])].filter(Boolean)
    .filter((d, i, a) => a.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i);
  const presence = online === null ? null : online ? "Available" : "Offline";

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast.show(`${what} copied`, "success"); }
    catch { toast.show(`Couldn't copy the ${what.toLowerCase()}`, "error"); }
  };

  const goOrgChart = () => { onClose(); navigate(`/org-chart?focus=${encodeURIComponent(person.id)}`); };

  const style = pos ? { left: pos.left, top: pos.top, width: CARD_W } : undefined;

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover keeps the card open; Esc/outside click close it
    <div
      ref={ref}
      className={`pc${pos ? "" : " pc-sheet"}`}
      style={style}
      role="dialog"
      aria-label={`Profile card: ${person.name || person.email}`}
      tabIndex={-1}
      onMouseEnter={onEnter}
      onMouseLeave={() => { if (!pinned) onLeave(); }}
      onMouseDown={() => { if (!pinned) onPin(); }}
    >
      <div className="pc-head">
        <div className="pc-avatar-wrap">
          <span className="person-avatar-circle pc-avatar" style={{ background: person.color || "var(--brand-500)" }} aria-hidden="true">
            {initials(person.name, person.email)}
          </span>
          {online !== null && <span className={`pc-presence-dot ${online ? "on" : "off"}`} aria-hidden="true" />}
        </div>
        <div className="pc-id">
          <div className="pc-name">{person.name || person.email}</div>
          {person.title && <div className="pc-title">{person.title}</div>}
          {depts[0] && <div className="pc-sub">{depts[0]}</div>}
          <div className="pc-status">
            {presence && <span className={`pc-status-pill ${online ? "on" : ""}`}>{presence}</span>}
            {time && <span className="pc-time"><Clock size={12} aria-hidden="true" /> {time} local time</span>}
          </div>
        </div>
        <button type="button" className="pc-icon-btn pc-close" onClick={onClose} aria-label="Close profile card"><X size={16} /></button>
      </div>

      <div className="pc-actions">
        {person.email && (
          <a className="pc-action" href={`mailto:${person.email}`} aria-label={`Email ${person.name || person.email}`}>
            <Mail size={16} /><span>Email</span>
          </a>
        )}
        {person.phone && (
          <a className="pc-action" href={`tel:${person.phone.replace(/[^0-9+]/g, "")}`} aria-label={`Call ${person.name || person.email}`}>
            <Phone size={16} /><span>Call</span>
          </a>
        )}
        <button type="button" className="pc-action" onClick={goOrgChart}>
          <Network size={16} /><span>Org chart</span>
        </button>
        {canEdit && !editing && (
          <button type="button" className="pc-action" onClick={() => { onPin(); setEditing(true); }}>
            <Pencil size={16} /><span>Edit</span>
          </button>
        )}
      </div>

      {editing ? (
        <EditForm person={person} isSelf={isSelf} isAdmin={isAdmin} people={people} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="pc-tabs" role="tablist" aria-label="Profile sections">
            {[["overview", "Overview"], ["organization", "Organization"], ["contact", "Contact"]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`pc-tab${tab === k ? " active" : ""}`}
                onClick={() => { onPin(); setTab(k); }}>
                {l}
              </button>
            ))}
          </div>

          <div className="pc-body" role="tabpanel">
            {tab === "overview" && (
              <>
                <div className="pc-section-title">Contact information</div>
                {person.email && (
                  <Row icon={Mail} label="Email">
                    <a href={`mailto:${person.email}`}>{person.email}</a>
                    <button type="button" className="pc-icon-btn pc-inline" onClick={() => copy(person.email, "Email")} aria-label="Copy email"><Copy size={13} /></button>
                  </Row>
                )}
                {person.phone && <Row icon={Phone} label="Work phone"><a href={`tel:${person.phone.replace(/[^0-9+]/g, "")}`}>{person.phone}</a></Row>}
                {person.location && <Row icon={MapPin} label="Location">{person.location}</Row>}

                <div className="pc-section-title">Reports to</div>
                {manager
                  ? <MiniPerson p={manager} onClick={onShowPerson} />
                  : <p className="pc-muted">No manager set — top of the org.</p>}

                {reports.length > 0 && (
                  <button type="button" className="pc-link" onClick={() => { onPin(); setTab("organization"); }}>
                    <Users size={14} /> {reports.length} direct report{reports.length > 1 ? "s" : ""}
                  </button>
                )}

                {person.skills?.length > 0 && (
                  <>
                    <div className="pc-section-title">Skills</div>
                    <div className="pc-chips">{person.skills.slice(0, 10).map((s) => <span key={s} className="pc-chip">{s}</span>)}</div>
                  </>
                )}
                {person.bio && (
                  <>
                    <div className="pc-section-title">About</div>
                    <p className="pc-bio">{person.bio}</p>
                  </>
                )}
              </>
            )}

            {tab === "organization" && (
              <>
                <div className="pc-section-title">Reporting line</div>
                <div className="pc-chain">
                  {[...chain].reverse().map((m, i) => (
                    <div key={m.id} className="pc-chain-row" style={{ paddingLeft: i * 14 }}>
                      <MiniPerson p={m} onClick={onShowPerson} />
                    </div>
                  ))}
                  <div className="pc-chain-row" style={{ paddingLeft: chain.length * 14 }}>
                    <MiniPerson p={person} onClick={onShowPerson} current />
                  </div>
                </div>
                <div className="pc-section-title">Direct reports {reports.length > 0 && `(${reports.length})`}</div>
                {reports.length > 0
                  ? <div className="pc-list">{reports.map((r) => <MiniPerson key={r.id} p={r} onClick={onShowPerson} />)}</div>
                  : <p className="pc-muted">No one reports to {person.name?.split(" ")[0] || "them"}.</p>}
              </>
            )}

            {tab === "contact" && (
              <>
                <Row icon={Mail} label="Email">{person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : "—"}</Row>
                <Row icon={Phone} label="Work phone">{person.phone ? <a href={`tel:${person.phone.replace(/[^0-9+]/g, "")}`}>{person.phone}</a> : "—"}</Row>
                <Row icon={MapPin} label="Location">{person.location || "—"}</Row>
                <Row icon={Clock} label="Local time">{time ? `${time} (${person.timeZone.replace(/_/g, " ")})` : "Time zone not set"}</Row>
                <Row icon={Building2} label={depts.length > 1 ? "Departments" : "Department"}>{depts.length ? depts.join(", ") : "—"}</Row>
                <Row icon={Briefcase} label="Workspace role">{ROLE_LABEL[person.role] || person.role || "—"}</Row>
              </>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
