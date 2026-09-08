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

  const onHourChange = (e) => {
    let h = e.target.value.replace(/\D/g, "").slice(0, 2);
    const num = parseInt(h, 10);
    if (num > 12) h = "12";
    if (num < 1 && h.length === 2) h = "01";
    onChange(buildValue(datePart, h || "12", minute, period));
  };

  const onMinuteChange = (e) => {
    let m = e.target.value.replace(/\D/g, "").slice(0, 2);
    const num = parseInt(m, 10);
    if (num > 59) m = "59";
    onChange(buildValue(datePart, hour, m.padStart(2, "0") || "00", period));
  };

  const onPeriodChange = (per) => {
    onChange(buildValue(datePart, hour, minute, per));
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
          value={hour}
          onChange={onHourChange}
          disabled={disabled}
          maxLength={2}
          placeholder="12"
        />
        <span className="dtp-colon">:</span>
        <input
          className="dtp-hm"
          type="text"
          value={minute}
          onChange={onMinuteChange}
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
