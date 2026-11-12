import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Users, Clock, MapPin, AlignLeft, Folder, Tag, AlertTriangle, Video, Trash2 } from "lucide-react";
import { useConfirm } from "../../hooks/useConfirm";
import {
  fromLocalParts, toLocalDateValue, toLocalTimeValue, toServerDateTime,
} from "../../utils/serverTime";
import {
  MEETING_TYPES, findConflicts, formatDuration, isLink, minutesBetween,
  meetingStart, meetingEnd, parseAttendees, timeOptions,
} from "../../utils/calendarMeetings";
import { detectPlatform } from "../../utils/conferenceLink";

const TIME_OPTIONS = timeOptions(15);

function initialForm(meeting, slot) {
  const start = meeting ? meetingStart(meeting) : slot.start;
  const end = meeting ? meetingEnd(meeting) : slot.end;
  return {
    title: meeting?.title || "",
    attendees: meeting?.attendees || [],
    attendeeDraft: "",
    startDate: toLocalDateValue(start),
    startTime: toLocalTimeValue(start),
    endDate: toLocalDateValue(end),
    endTime: toLocalTimeValue(end),
    location: meeting?.location || "",
    meetingType: meeting?.meetingType || "OTHER",
    projectId: meeting?.projectId || "",
    agenda: meeting?.agenda || "",
  };
}

/** Time <select> that also shows a value off the 15-minute grid (e.g. 10:07). */
function TimeSelect({ id, value, onChange, label }) {
  const opts = TIME_OPTIONS.some((o) => o.value === value) || !value
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value, label: value }].sort((a, b) => a.value.localeCompare(b.value));
  return (
    <select id={id} aria-label={label} className="cal-ed-time" value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/**
 * Outlook-style "New event / Edit event" form.
 * Esc = close (asks first if there are unsaved changes), Ctrl/⌘+Enter or Ctrl/⌘+S = save.
 */
export default function MeetingEditor({ meeting, slot, projects, team, meetings, onSave, onDelete, onClose, onOpenFull }) {
  const confirm = useConfirm();
  const [form, setForm] = useState(() => initialForm(meeting, slot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [startOfForm] = useState(() => JSON.stringify(initialForm(meeting, slot)));
  const titleRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const start = fromLocalParts(form.startDate, form.startTime);
  const end = fromLocalParts(form.endDate, form.endTime);
  const durationMins = start && end ? minutesBetween(start, end) : 0;
  const rangeOk = start && end && durationMins > 0;

  // Moving the start keeps the meeting's length, as Outlook does.
  const moveStart = (dateStr, timeStr) => {
    const oldStart = fromLocalParts(form.startDate, form.startTime);
    const oldEnd = fromLocalParts(form.endDate, form.endTime);
    const newStart = fromLocalParts(dateStr, timeStr);
    if (!newStart) { setForm((f) => ({ ...f, startDate: dateStr, startTime: timeStr })); return; }
    const keep = oldStart && oldEnd && oldEnd > oldStart ? oldEnd - oldStart : 30 * 60000;
    const newEnd = new Date(newStart.getTime() + keep);
    setForm((f) => ({
      ...f, startDate: dateStr, startTime: timeStr,
      endDate: toLocalDateValue(newEnd), endTime: toLocalTimeValue(newEnd),
    }));
  };

  const conflicts = useMemo(
    () => (rangeOk ? findConflicts(start, end, meetings, meeting?.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.startDate, form.startTime, form.endDate, form.endTime, meetings, meeting?.id],
  );

  const teamOptions = useMemo(
    () => (team || []).filter((t) => t.email || t.name),
    [team],
  );

  const addAttendees = (text) => {
    const add = parseAttendees(text).map((a) => {
      // Picking "Name <email>" or a bare name from the list stores the email.
      const byLabel = teamOptions.find((t) => `${t.name} <${t.email}>` === a || t.name === a);
      return byLabel?.email || a;
    });
    if (!add.length) return;
    setForm((f) => {
      const have = new Set(f.attendees.map((x) => x.toLowerCase()));
      return { ...f, attendeeDraft: "", attendees: [...f.attendees, ...add.filter((a) => !have.has(a.toLowerCase()))] };
    });
  };

  const removeAttendee = (a) => set("attendees", form.attendees.filter((x) => x !== a));

  const attendeeLabel = (a) => {
    const t = teamOptions.find((x) => x.email && x.email.toLowerCase() === a.toLowerCase());
    return t?.name ? `${t.name}` : a;
  };

  const dirty = JSON.stringify(form) !== startOfForm;

  const requestClose = async () => {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({
        title: meeting ? "Discard changes?" : "Discard this meeting?",
        message: "Your changes haven't been saved.",
        confirmText: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  const save = async () => {
    setError("");
    if (!form.title.trim()) { setError("Add a title."); titleRef.current?.focus(); return; }
    if (!rangeOk) { setError("The meeting must end after it starts."); return; }
    const attendees = [...form.attendees, ...parseAttendees(form.attendeeDraft)];
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        attendees: [...new Set(attendees)],
        meetingDate: toServerDateTime(start),
        durationMins,
        location: form.location.trim(),
        meetingType: form.meetingType,
        projectId: form.projectId || null,
        agenda: form.agenda,
      });
    } catch (e) {
      setError(e?.response?.data?.message || "Couldn't save the meeting. Please try again.");
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); requestClose(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
      e.preventDefault(); save();
      return;
    }
    if (e.key === "Tab") {
      // Keep focus inside the dialog.
      const items = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  const platform = isLink(form.location) ? detectPlatform(form.location) : null;

  return createPortal(
    <div
      className="cal-ed-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      role="presentation"
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog-level Esc / Ctrl+Enter / focus trap */}
      <div
        className="cal-ed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-ed-heading"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="cal-ed-head">
          <h2 id="cal-ed-heading">{meeting ? "Edit meeting" : "New meeting"}</h2>
          <button type="button" className="cal-icon-btn" onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="cal-ed-body">
          <input
            ref={titleRef}
            className="cal-ed-title"
            placeholder="Add a title"
            aria-label="Title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
          />

          <div className="cal-ed-row">
            <Users size={16} className="cal-ed-icon" aria-hidden="true" />
            <div className="cal-ed-field">
              <div className="cal-ed-chips">
                {form.attendees.map((a) => (
                  <span key={a} className="cal-chip" title={a}>
                    {attendeeLabel(a)}
                    <button type="button" onClick={() => removeAttendee(a)} aria-label={`Remove ${a}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <input
                  className="cal-ed-chip-input"
                  list="cal-ed-team"
                  placeholder={form.attendees.length ? "Add more" : "Invite attendees"}
                  aria-label="Invite attendees"
                  value={form.attendeeDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/[,;]$/.test(v)) addAttendees(v);
                    else if (teamOptions.some((t) => `${t.name} <${t.email}>` === v)) addAttendees(v);
                    else set("attendeeDraft", v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && form.attendeeDraft.trim()) { e.preventDefault(); addAttendees(form.attendeeDraft); }
                    if (e.key === "Backspace" && !form.attendeeDraft && form.attendees.length) {
                      removeAttendee(form.attendees[form.attendees.length - 1]);
                    }
                  }}
                  onBlur={() => form.attendeeDraft.trim() && addAttendees(form.attendeeDraft)}
                />
                <datalist id="cal-ed-team">
                  {teamOptions.map((t) => (
                    <option key={t.id || t.email} value={t.email ? `${t.name} <${t.email}>` : t.name} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          <div className="cal-ed-row">
            <Clock size={16} className="cal-ed-icon" aria-hidden="true" />
            <div className="cal-ed-field">
              <div className="cal-ed-when">
                <input
                  type="date" aria-label="Start date" value={form.startDate}
                  onChange={(e) => moveStart(e.target.value, form.startTime)}
                />
                <TimeSelect id="cal-ed-start-time" label="Start time" value={form.startTime} onChange={(v) => moveStart(form.startDate, v)} />
                <span className="cal-ed-to">to</span>
                <input
                  type="date" aria-label="End date" value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                />
                <TimeSelect id="cal-ed-end-time" label="End time" value={form.endTime} onChange={(v) => set("endTime", v)} />
                {rangeOk && <span className="cal-ed-dur">{formatDuration(durationMins)}</span>}
              </div>
              {!rangeOk && start && end && (
                <div className="cal-ed-warn" role="alert"><AlertTriangle size={14} /> The meeting must end after it starts.</div>
              )}
              {conflicts.length > 0 && (
                <div className="cal-ed-conflict">
                  <AlertTriangle size={14} />
                  {conflicts.length === 1
                    ? <>Conflicts with <strong>{conflicts[0].title}</strong></>
                    : <>Conflicts with {conflicts.length} other meetings</>}
                </div>
              )}
            </div>
          </div>

          <div className="cal-ed-row">
            <MapPin size={16} className="cal-ed-icon" aria-hidden="true" />
            <div className="cal-ed-field">
              <input
                className="cal-ed-input"
                placeholder="Add a room, or paste a Teams / Zoom / Meet link"
                aria-label="Location or meeting link"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                maxLength={2000}
              />
              {platform && (
                <div className="cal-ed-hint"><Video size={13} /> {platform.name} meeting — attendees get a Join button</div>
              )}
            </div>
          </div>

          <div className="cal-ed-row cal-ed-row-split">
            <Tag size={16} className="cal-ed-icon" aria-hidden="true" />
            <div className="cal-ed-field cal-ed-two">
              <select aria-label="Meeting type" value={form.meetingType} onChange={(e) => set("meetingType", e.target.value)}>
                {MEETING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="cal-ed-proj">
                <Folder size={15} className="cal-ed-icon" aria-hidden="true" />
                <select aria-label="Project" value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
                  <option value="">No project</option>
                  {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="cal-ed-row cal-ed-row-top">
            <AlignLeft size={16} className="cal-ed-icon" aria-hidden="true" />
            <div className="cal-ed-field">
              <textarea
                className="cal-ed-input cal-ed-agenda"
                placeholder="Add an agenda or description"
                aria-label="Agenda"
                rows={5}
                value={form.agenda}
                onChange={(e) => set("agenda", e.target.value)}
              />
            </div>
          </div>

          {error && <div className="cal-ed-error" role="alert">{error}</div>}
        </div>

        <div className="cal-ed-foot">
          <div className="cal-ed-foot-left">
            {meeting && (
              <button type="button" className="btn cal-btn-ghost cal-danger-text" onClick={onDelete} disabled={saving}>
                <Trash2 size={15} /> Delete
              </button>
            )}
            {meeting && onOpenFull && (
              <button type="button" className="btn cal-btn-ghost" onClick={onOpenFull} disabled={saving}>
                Notes &amp; action items
              </button>
            )}
          </div>
          <div className="cal-ed-foot-right">
            <span className="cal-ed-kbd" aria-hidden="true">Ctrl+Enter to save</span>
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>Discard</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim() || !rangeOk}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
    , document.body,
  );
}
