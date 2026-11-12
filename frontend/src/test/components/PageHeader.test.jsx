import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import PageHeader from "../../components/PageHeader";

/**
 * PageHeader is used at the top of nearly every page in the app, including
 * every page built or touched during this engagement (ChangeRequests,
 * AdminCenter's cards, WorkspaceSettings, etc.) — a real, exercised
 * component, not a synthetic test target.
 */
describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Change Requests" />);
    expect(screen.getByRole("heading", { name: "Change Requests" })).toBeInTheDocument();
  });

  it("renders the description, and no longer shows an emoji icon beside the title", () => {
    render(<PageHeader icon="🔧" title="Change Requests" description="Propose and review changes" />);
    expect(screen.getByText("Propose and review changes")).toBeInTheDocument();
    expect(screen.queryByText("🔧")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change Requests" })).toBeInTheDocument();
  });

  it("omits the description block entirely when none is given, rather than rendering an empty <p>", () => {
    const { container } = render(<PageHeader title="Minimal" />);
    expect(container.querySelector("p")).not.toBeInTheDocument();
  });

  it("renders the action slot (e.g. a 'New' button) when provided", () => {
    render(<PageHeader title="Change Requests" action={<button>+ New Change Request</button>} />);
    expect(screen.getByRole("button", { name: "+ New Change Request" })).toBeInTheDocument();
  });

  it("omits the action slot entirely when none is given", () => {
    const { container } = render(<PageHeader title="Minimal" />);
    expect(container.querySelector(".page-header-action")).not.toBeInTheDocument();
  });

  it("has no automatically-detectable accessibility violations (axe-core)", async () => {
    // Complementary to the static jsx-a11y ESLint rules (eslint.config.js),
    // not a replacement — see docs/ACCESSIBILITY.md for an empirically
    // verified limitation of running axe-core inside jsdom.
    const { container } = render(
      <PageHeader icon="🔧" title="Change Requests" description="Propose and review changes"
        action={<button>+ New Change Request</button>} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
