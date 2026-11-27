// The calendar's New-meeting form: what it sends to the server. (API mocked: the real backend is covered by MeetingLifecycleApiTest and the browser run.)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "me@x.com", name: "Me" } }) }));
vi.mock("../../api/meetings", () => ({ getMeetingAvailability: vi.fn(() => Promise.resolve({ data: [] })) }));
import MeetingEditor from "../../components/calendar/MeetingEditor";

const slot = () => ({ start: new Date("2030-11-30T15:00:00"), end: new Date("2030-11-30T15:45:00") });

describe("MeetingEditor saves what the server needs", () => {
  let onSave;
  beforeEach(() => { onSave = vi.fn(() => Promise.resolve()); });
  const open = () => render(<MeetingEditor meeting={null} slot={slot()} projects={[]} team={[]} meetings={[]} onSave={onSave} onClose={() => {}} />);

  it("sends title, the start in UTC, the length, the attendees and the browser's time zone", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Kickoff  " } });
    const att = screen.getByLabelText("Invite attendees");
    for (const a of ["a@x.com", "A@X.com", "b@x.com"]) { fireEvent.change(att, { target: { value: a } }); fireEvent.keyDown(att, { key: "Enter" }); }
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const p = onSave.mock.calls[0][0];
    expect(p.title).toBe("Kickoff");
    expect(p.durationMins).toBe(45);
    expect(p.meetingDate).toBe(new Date("2030-11-30T15:00:00").toISOString());   // local time sent as an exact UTC instant
    expect(p.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(p.attendees.map((x) => x.toLowerCase()).sort()).toEqual(["a@x.com", "b@x.com"]);   // no duplicate invitation for the same address
  });

  it("won't save without a title", async () => {
    open();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
