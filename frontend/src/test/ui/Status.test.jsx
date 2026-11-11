import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Status, { StatusGlyph } from "../../ui/Status";
import Priority from "../../ui/Priority";
import { statusMeta, priorityMeta, initialsOf } from "../../ui/meta";

describe("ui/Status", () => {
  it("shows a plain-language label next to the glyph, so state is not colour-only", () => {
    render(<Status status="IN_PROGRESS" />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("keeps the label for screen readers when it is visually hidden", () => {
    render(<Status status="DONE" hideLabel />);
    expect(screen.getByText("Done")).toHaveClass("ui-sr-only");
  });

  it("uses a different shape (diamond) for blocked and overdue work", () => {
    const { container } = render(<><StatusGlyph status="BLOCKED" /><StatusGlyph status="TODO" /></>);
    const glyphs = container.querySelectorAll(".ui-glyph");
    expect(glyphs[0]).toHaveClass("ui-glyph--diamond");
    expect(glyphs[1]).toHaveClass("ui-glyph--circle");
  });

  it("falls back to a readable label for unknown statuses", () => {
    expect(statusMeta("WAITING_ON_CLIENT").label).toBe("Waiting on client");
    expect(statusMeta(undefined).label).toBe("No status");
  });
});

describe("ui/Priority and helpers", () => {
  it("labels priorities in sentence case", () => {
    render(<Priority priority="HIGH" />);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(priorityMeta("LOW").label).toBe("Low");
  });

  it("builds initials from names and emails", () => {
    expect(initialsOf("Priya Nair")).toBe("PN");
    expect(initialsOf("sam.lee@example.com")).toBe("SL");
    expect(initialsOf("")).toBe("?");
  });
});
