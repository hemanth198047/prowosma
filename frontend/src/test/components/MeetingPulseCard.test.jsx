import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const dashboard = vi.fn();
const prepare = vi.fn();
vi.mock("../../api/aiMeetingAssistant", () => ({ getUmaDashboard: () => dashboard(), getUmaPrepare: () => prepare() }));
import MeetingPulseCard from "../../components/MeetingPulseCard";

const renderCard = () => render(<MemoryRouter><MeetingPulseCard /></MemoryRouter>);
const empty = { upcoming: [], inProgress: [], recent: [], awaitingReview: [] };

describe("MeetingPulseCard (from Meetings)", () => {
  beforeEach(() => { dashboard.mockReset(); prepare.mockReset(); });

  it("says so when there are no meetings today, and shows the open count", async () => {
    dashboard.mockResolvedValue({ data: empty });
    prepare.mockResolvedValue({ data: { counts: { openActionItems: 0 } } });
    renderCard();
    expect(await screen.findByText("No meetings today.")).toBeInTheDocument();
    expect(screen.getByText("open actions")).toBeInTheDocument();
    expect(screen.queryByText("overdue")).not.toBeInTheDocument();
  });

  it("shows overdue items and blockers only when there are some", async () => {
    dashboard.mockResolvedValue({ data: { ...empty, awaitingReview: [{ id: "r1" }] } });
    prepare.mockResolvedValue({ data: { counts: { openActionItems: 3, overdueActionItems: 1, activeBlockers: 0 } } });
    renderCard();
    expect(await screen.findByText("overdue")).toBeInTheDocument();
    expect(screen.getByText("to review")).toBeInTheDocument();
    expect(screen.queryByText("blockers")).not.toBeInTheDocument();
  });

  it("lists today's meetings, once each", async () => {
    const today = new Date(); today.setHours(9, 0, 0, 0);
    const m = { id: "m1", title: "Weekly sync", meetingAt: today.toISOString() };
    dashboard.mockResolvedValue({ data: { ...empty, upcoming: [m], recent: [m] } });
    prepare.mockResolvedValue({ data: { counts: {} } });
    renderCard();
    expect(await screen.findAllByText("Weekly sync")).toHaveLength(1);
  });

  it("explains when meetings can't be loaded", async () => {
    dashboard.mockRejectedValue(new Error("down"));
    prepare.mockResolvedValue({ data: { counts: {} } });
    renderCard();
    expect(await screen.findByText("Couldn't load meetings right now.")).toBeInTheDocument();
  });
});
