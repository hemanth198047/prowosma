import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../api/client", () => ({ default: { post: vi.fn() } }));
import client from "../../api/client";
import { resendMeetingInvites } from "../../api/meetings";
import EventPeek from "../../components/calendar/EventPeek";

const peek = {
  key: "k", type: "meeting", rect: { left: 10, top: 10, right: 50, bottom: 30, width: 40, height: 20 },
  item: { id: "m1", title: "Review", status: "SCHEDULED", attendees: ["a@x.com"], meetingDate: "2026-12-01T10:00:00", durationMinutes: 30 },
};

describe("resend invites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("posts to the resend endpoint, optionally narrowed to some people", async () => {
    client.post.mockResolvedValue({ data: { sent: [], failed: [] } });
    await resendMeetingInvites("m1");
    expect(client.post).toHaveBeenLastCalledWith("/meetings/m1/resend-invites", {});
    await resendMeetingInvites("m1", ["a@x.com"]);
    expect(client.post).toHaveBeenLastCalledWith("/meetings/m1/resend-invites", { emails: ["a@x.com"] });
  });

  it("shows a Resend invites button on the meeting card when a handler is given", () => {
    const onResend = vi.fn();
    render(<EventPeek peek={peek} projectName={() => ""} teamName={() => ""} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} onOpen={() => {}} onResend={onResend} />);
    fireEvent.click(screen.getByRole("button", { name: "Resend invites" }));
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("hides it when there is nobody to invite", () => {
    render(<EventPeek peek={peek} projectName={() => ""} teamName={() => ""} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} onOpen={() => {}} onResend={null} />);
    expect(screen.queryByRole("button", { name: "Resend invites" })).toBeNull();
  });
});
