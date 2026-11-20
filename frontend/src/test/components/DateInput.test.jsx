import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DateInput, { isCompleteDateValue } from "../../components/DateInput";

// What Chrome reports while someone types 12/25/2026 into a date field: the year arrives one digit at a time.
const TYPING = ["2026-12-25".replace("2026", "0002"), "0020-12-25", "0202-12-25", "2026-12-25"];
const type = (el, values) => {
  for (const v of values) { fireEvent.keyDown(el, { key: v.slice(-1) }); fireEvent.change(el, { target: { value: v } }); }
};

describe("DateInput", () => {
  it("only passes on a complete date while typing (not the half-typed years)", () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Due" value="" onChange={onChange} />);
    const el = screen.getByLabelText("Due");
    el.focus();
    type(el, TYPING);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("2026-12-25");
    expect(el).toHaveValue("2026-12-25");
  });

  it("a rule like 'not in the past' doesn't fire on half-typed years, only on the finished date", () => {
    const onChange = vi.fn(); const onInvalid = vi.fn();
    const validate = (v) => (v < "2026-01-01" ? "past" : null);
    render(<DateInput aria-label="Due" value="" onChange={onChange} validate={validate} onInvalid={onInvalid} />);
    const el = screen.getByLabelText("Due");
    el.focus();
    type(el, TYPING);
    expect(onInvalid).not.toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)[0].target.value).toBe("2026-12-25");
  });

  it("a finished date that breaks the rule is reported when the person leaves the field, and the field goes back", () => {
    const onChange = vi.fn(); const onInvalid = vi.fn();
    render(<DateInput aria-label="Due" value="2027-03-01" onChange={onChange} validate={(v) => (v < "2026-01-01" ? "past" : null)} onInvalid={onInvalid} />);
    const el = screen.getByLabelText("Due");
    el.focus();
    type(el, ["0002-03-01", "0020-03-01", "0202-03-01", "2020-03-01"]);
    expect(onInvalid).not.toHaveBeenCalled();
    fireEvent.blur(el);
    expect(onInvalid).toHaveBeenCalledWith("past");
    expect(onChange).not.toHaveBeenCalled();
    expect(el).toHaveValue("2027-03-01");
  });

  it("saveOnBlur: a typed date is passed on once, when the person leaves the field (or presses Enter)", () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Due" saveOnBlur value="2027-03-01" onChange={onChange} />);
    const el = screen.getByLabelText("Due");
    el.focus();
    type(el, ["2027-03-02", "2027-03-25"]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("2027-03-25");
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("saveOnBlur: a date picked from the calendar (no typing) is passed on at once", () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Due" saveOnBlur value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2027-05-04" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("leaving a half-typed date puts the last good value back; clearing and leaving clears it", () => {
    const onChange = vi.fn();
    render(<DateInput aria-label="Due" value="2027-03-01" onChange={onChange} />);
    const el = screen.getByLabelText("Due");
    el.focus();
    type(el, ["0002-03-01"]);
    fireEvent.blur(el);
    expect(el).toHaveValue("2027-03-01");
    expect(onChange).not.toHaveBeenCalled();
    el.focus();
    fireEvent.keyDown(el, { key: "Backspace" });
    fireEvent.change(el, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(el);
    expect(onChange.mock.calls[0][0].target.value).toBe("");
  });

  it("knows a complete value for each field type", () => {
    expect(isCompleteDateValue("2026-12-25")).toBe(true);
    expect(isCompleteDateValue("0202-12-25")).toBe(false);
    expect(isCompleteDateValue("2026-12-25T09:30", "datetime-local")).toBe(true);
    expect(isCompleteDateValue("0020-12-25T09:30", "datetime-local")).toBe(false);
    expect(isCompleteDateValue("")).toBe(false);
  });
});
