import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AiResult, { toText } from "../../components/AiResult";

describe("AiResult", () => {
  it("shows a problem in plain words with what to do, and a Settings button only for admins on settings problems", () => {
    const data = { error: "The AI provider didn't accept the saved key.", hint: "An admin should open AI Settings.", kind: "AUTH" };
    const { rerender } = render(<AiResult data={data} canOpenSettings onOpenSettings={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("didn't accept the saved key");
    expect(screen.getByText(/open AI Settings\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open AI Settings" })).toBeInTheDocument();
    rerender(<AiResult data={data} canOpenSettings={false} onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Open AI Settings" })).toBeNull();
  });

  it("says kindly when there is nothing to report yet", () => {
    render(<AiResult data={{ message: "You have no open tasks." }} />);
    expect(screen.getByRole("status")).toHaveTextContent("You have no open tasks.");
  });

  it("lays a report out as labelled sections, lists and cards, not raw data", () => {
    render(<AiResult data={{
      yesterday: "Finished login", blockers: "None",
      risks: [{ title: "Late API", severity: "HIGH", mitigation: "Add a tester" }],
      tips: ["Take a break", "Plan tomorrow"],
    }} />);
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Finished login")).toBeInTheDocument();
    expect(screen.getByText("Late API")).toBeInTheDocument();
    expect(screen.getByText("Take a break")).toBeInTheDocument();
    expect(screen.queryByText(/\{/)).toBeNull();
  });

  it("copies as readable text", () => {
    expect(toText({ yesterday: "Done", tips: ["a", "b"] })).toBe("Yesterday: Done\nTips:\n  • a\n  • b");
  });
});
