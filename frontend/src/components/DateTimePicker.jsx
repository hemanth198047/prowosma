import { useState, useEffect } from "react";

/**
 * DateTimePicker — replaces datetime-local input
 * Shows separate date + AM/PM time picker
 * Uses workspace timezone for display
 */

/**
 * Usage:
 *   <DateTimePicker value={form.dueDate} onChange={(iso) => set("dueDate", iso)} />
 *
 * value: ISO string (UTC) or ""
 * onChange: called with ISO string or ""
 */
export default function DateTimePicker({ value, onChange, disabled = false, placeholder = "Select date" }) {
  // Parse current value into date + time parts
  const getDatePart = () => value ? value.slice(0, 10) : "";
  const getTimePart = () => {
    if (!value) return { hour: "12", minute: "00", period: "AM" };
    const timePart = value.slice(11, 16) || "00:00";
    let [h, m] = timePart.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return { hour: String(h).padStart(2, "0"), minute: String(m).padStart(2, "0"), period };
  };

  const datePart = getDatePart();
  const { hour, minute, period } = getTimePart();

  // The hour/minute text boxes used to be driven directly by `hour`/`minute`
  // above (recomputed from `value` on every render) and reformat themselves
  // — pad to 2 digits, clamp, etc. — on every keystroke via onChange. That
  // fights typing: clearing the field to enter a new number made it snap
  // back to a default ("" || "12" → "12") before you could type the digit,
  // and re-padding mid-type (e.g. "1" → "01") shifts the cursor unpredictably.
  // These two local buffers hold exactly what's currently being typed —
  // including a blank field, or a single un-padded digit — and are only
  // reconciled with the real value (padded, clamped, pushed via onChange)
  // on blur. They resync from the real value whenever it changes from
  // outside (a new date picked, the form reset, another field's edit).
  const [hourInput, setHourInput] = useState(hour);
  const [minuteInput, setMinuteInput] = useState(minute);
  useEffect(() => { setHourInput(hour); }, [hour]);
  useEffect(() => { setMinuteInput(minute); }, [minute]);

  const buildValue = (date, h, m, per) => {
    if (!date) return "";
    let hr = parseInt(h, 10);
    if (per === "PM" && hr !== 12) hr += 12;
    if (per === "AM" && hr === 12) hr = 0;
    return `${date}T${String(hr).padStart(2, "0")}:${m}`;
  };

  const onDateChange = (e) => {
    const newDate = e.target.value;
    onChange(buildValue(newDate, hour, minute, period));
  };

  // While typing: just track the raw digits, up to 2, no padding/clamping
  // and no onChange yet — so the field can sit at "", "1", etc. without
  // being forced back to a formatted value mid-keystroke.
  const onHourInput = (e) => {
    setHourInput(e.target.value.replace(/\D/g, "").slice(0, 2));
  };
  const onMinuteInput = (e) => {
    setMinuteInput(e.target.value.replace(/\D/g, "").slice(0, 2));
  };

  // On blur: now normalize (clamp to a valid hour/minute, pad to 2 digits)
  // and actually commit it via onChange. An empty field on blur falls back
  // to the last real value rather than a hardcoded default, so tabbing
  // through an untouched field doesn't silently change the time.
  const commitHour = () => {
    let h = hourInput;
    if (h === "") { setHourInput(hour); return; }
    let num = parseInt(h, 10);
    if (num > 12) num = 12;
    if (num < 1) num = 1;
    const padded = String(num).padStart(2, "0");
    setHourInput(padded);
    onChange(buildValue(datePart || todayIso(), padded, minute, period));
  };
  const commitMinute = () => {
    let m = minuteInput;
    if (m === "") { setMinuteInput(minute); return; }
    let num = parseInt(m, 10);
    if (num > 59) num = 59;
    const padded = String(num).padStart(2, "0");
    setMinuteInput(padded);
    onChange(buildValue(datePart || todayIso(), hour, padded, period));
  };

  // If someone sets a time before ever picking a date, default the date to
  // today rather than silently discarding the time they just entered (the
  // old buildValue(date, ...) with date="" returning "" meant typing a time
  // with no date selected did nothing at all).
  const todayIso = () => new Date().toISOString().slice(0, 10);

  const onPeriodChange = (per) => {
    onChange(buildValue(datePart || todayIso(), hour, minute, per));
  };

  const onKeyDownCommit = (e, commitFn) => {
    if (e.key === "Enter") { e.currentTarget.blur(); }
  };

  return (
    <div className="dtp-container">
      {/* Date picker */}
      <input
        type="date"
        value={datePart}
        onChange={onDateChange}
        disabled={disabled}
        placeholder={placeholder}
        style={{ flex: 1, opacity: disabled ? 0.4 : 1 }}
      />

      {/* Time picker */}
      <div className={"dtp-time" + (disabled ? " dtp-disabled" : "")}>
        <input
          className="dtp-hm"
          type="text"
          inputMode="numeric"
          value={hourInput}
          onChange={onHourInput}
          onBlur={commitHour}
          onKeyDown={(e) => onKeyDownCommit(e, commitHour)}
          disabled={disabled}
          maxLength={2}
          placeholder="12"
        />
        <span className="dtp-colon">:</span>
        <input
          className="dtp-hm"
          type="text"
          inputMode="numeric"
          value={minuteInput}
          onChange={onMinuteInput}
          onBlur={commitMinute}
          onKeyDown={(e) => onKeyDownCommit(e, commitMinute)}
          disabled={disabled}
          maxLength={2}
          placeholder="00"
        />
        {/* AM/PM toggle */}
        <div className="dtp-period">
          <button
            type="button"
            className={"dtp-period-btn" + (period === "AM" ? " active" : "")}
            onClick={() => !disabled && onPeriodChange("AM")}
            disabled={disabled}
          >AM</button>
          <button
            type="button"
            className={"dtp-period-btn" + (period === "PM" ? " active" : "")}
            onClick={() => !disabled && onPeriodChange("PM")}
            disabled={disabled}
          >PM</button>
        </div>
      </div>
    </div>
  );
}
