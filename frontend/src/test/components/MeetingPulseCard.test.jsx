import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const pulse = vi.fn();
vi.mock("../../api/dashboard", () => ({ getDashboardMeetingPulse: () => pulse() }));
import MeetingPulseCard from "../../components/MeetingPulseCard";

const renderCard = () => render(<MemoryRouter><MeetingPulseCard /></MemoryRouter>);

describe("MeetingPulseCard", () => {
  beforeEach(() => pulse.mockReset());

  it("shows one summary line when there is nothing to report", async () => {
    pulse.mockResolvedValue({ data: { todaysMeetings: [], carryForwardCounts: {}, recentlyCompleted: [] } });
    renderCard();
    expect(await screen.findByText("No meetings today · 0 open actions")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing urgent/)).not.toBeInTheDocument();
  });

  it("keeps the full panel as soon as there is anything to show", async () => {
    pulse.mockResolvedValue({ data: { todaysMeetings: [], carryForwardCounts: { openActionItems: 3 }, recentlyCompleted: [] } });
    renderCard();
    expect(await screen.findByText("No meetings scheduled today.")).toBeInTheDocument();
    expect(screen.getByText(/open actions/)).toHaveTextContent("3 open actions");
  });

  it("lists today's meetings when there are some", async () => {
    pulse.mockResolvedValue({ data: { todaysMeetings: [{ id: "m1", title: "Weekly sync", meetingDate: "2026-11-11T09:00:00Z" }], carryForwardCounts: {}, recentlyCompleted: [] } });
    renderCard();
    expect(await screen.findByText("Weekly sync")).toBeInTheDocument();
  });
});
