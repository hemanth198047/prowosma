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

describe("AiResult hides database ids", () => {
  const data = { dependencies: [{ taskId: "6affed557baf2fc3584fb530", dependsOnId: "6affeb517baf2fc3584fb529", reason: "AB50 REEL is a type of Reels Correction", confidence: "HIGH", taskTitle: "AB50 REEL", dependsOnTitle: "Reels Correction" }] };
  it("shows 'A waits for B' with the reason and no ids", () => {
    const { container } = render(<AiResult data={data} />);
    expect(screen.getByText("AB50 REEL")).toBeInTheDocument();
    expect(screen.getByText("waits for")).toBeInTheDocument();
    expect(screen.getByText("Reels Correction")).toBeInTheDocument();
    expect(screen.getByText("Very likely")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/6affed557baf2fc3584fb530|6affeb517baf2fc3584fb529/);
  });
  it("hides id fields and id-looking values elsewhere too", () => {
    const { container } = render(<AiResult data={{ items: [{ title: "Write spec", projectId: "abc", ref: "6affed557baf2fc3584fb530", note: "ok" }] }} />);
    expect(container.textContent).toContain("Write spec");
    expect(container.textContent).toContain("ok");
    expect(container.textContent).not.toMatch(/6affed557|abc/);
  });
});
