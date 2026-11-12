import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusPill from "../../components/ui/StatusPill";
import PriorityTag from "../../components/ui/PriorityTag";

describe("StatusPill", () => {
  it("shows a sentence-case label with the status family class", () => {
    render(<StatusPill status="ON_HOLD" />);
    const pill = screen.getByText("On hold");
    expect(pill.className).toContain("badge-on_hold");
  });
  it("renders nothing without a status", () => {
    const { container } = render(<StatusPill status={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("PriorityTag", () => {
  it("shows the word, not just a colour", () => {
    render(<PriorityTag priority="HIGH" />);
    expect(screen.getByText("High")).toBeTruthy();
  });
  it("keeps a screen-reader label when the word is hidden", () => {
    render(<PriorityTag priority="low" showLabel={false} />);
    expect(screen.getByText("Low priority")).toBeTruthy();
  });
  it("falls back to the raw value for unknown priorities", () => {
    render(<PriorityTag priority="Someday" />);
    expect(screen.getByText("Someday")).toBeTruthy();
  });
});
