import { useEffect, useRef, useState } from "react";

/**
 * A native date / datetime-local / month field that people can TYPE into, not only pick from.
 *
 * Browsers report every keystroke while a year is typed (12/25/0002, 0020, 0202, then 2026). Handing those
 * straight to a "not in the past" check or a server save broke typing: the half-typed year was rejected (the field
 * snapped back) or saved. Here:
 *  - the field always shows what is being typed;
 *  - the parent only hears a COMPLETE value (4-digit year from 1900), or "" when the field is cleared and left;
 *  - `saveOnBlur`: for fields that save on every change - a typed value is passed on when the person leaves the field
 *    or presses Enter; a value picked from the calendar is passed on at once;
 *  - `validate(value)` returns a message for a value that isn't allowed. It is only checked on complete values;
 *    when the person leaves the field with one, `onInvalid(message)` is called and the field goes back to the last
 *    good value.
 *
 * Drop-in for <input type="date">: onChange receives an event-like object, so `e => set(e.target.value)` keeps working.
 * Other props (min, max, disabled, aria-label, id, className, style, required…) go to the input.
 */
const PATTERN = {
  date: /^(\d{4})-\d{2}-\d{2}$/,
  "datetime-local": /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/,
  month: /^(\d{4})-\d{2}$/,
};
export function isCompleteDateValue(v, type = "date") {
  const m = (PATTERN[type] || PATTERN.date).exec(v || "");
  return !!m && Number(m[1]) >= 1900;
}

const NOT_TYPING = new Set(["Tab", "Enter", "Escape", "Shift"]);

export default function DateInput({ type = "date", value, onChange, saveOnBlur = false, validate, onInvalid, onBlur, onKeyDown, onFocus, ...rest }) {
  const outer = value ?? "";
  const [text, setText] = useState(outer);
  const focused = useRef(false);
  const typed = useRef(false);
  const committed = useRef(outer);

  // Follow changes from outside (another field, a reset, a saved value) unless the person is mid-edit here.
  useEffect(() => {
    committed.current = outer;
    if (!focused.current) setText(outer);
  }, [outer]);

  const send = (v) => {
    if (v === committed.current) return;
    committed.current = v;
    onChange?.({ target: { value: v }, currentTarget: { value: v } });
  };
  const errorFor = (v) => (v && validate ? validate(v) : null);

  const handleChange = (e) => {
    const v = e.target.value;
    setText(v);
    if (v === "") { if (!typed.current) send(""); return; }   // cleared with the picker's own button
    if (!isCompleteDateValue(v, type)) return;                 // still typing
    const err = errorFor(v);
    if (err) {
      if (!typed.current) { onInvalid?.(err); setText(committed.current); }   // picked: say so now
      return;                                                                 // typed: check again on leaving
    }
    if (saveOnBlur && typed.current) return;                   // typed into a saving field: save on leaving
    send(v);
  };

  const finish = () => {
    const v = text;
    typed.current = false;
    if (v === committed.current) return;
    if (v === "") { send(""); return; }
    if (!isCompleteDateValue(v, type)) { setText(committed.current); return; }   // left half-typed: undo
    const err = errorFor(v);
    if (err) { onInvalid?.(err); setText(committed.current); return; }
    send(v);
  };

  return (
    <input
      {...rest}
      type={type}
      value={text}
      onChange={handleChange}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish();
        else if (!NOT_TYPING.has(e.key)) typed.current = true;
        onKeyDown?.(e);
      }}
      onBlur={(e) => { focused.current = false; finish(); onBlur?.(e); }}
    />
  );
}
