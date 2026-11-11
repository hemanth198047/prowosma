import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ConfirmProvider } from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";

function Harness({ opts, onResult }) {
  const confirm = useConfirm();
  return <button onClick={async () => onResult(await confirm(opts))}>open</button>;
}
const setup = (opts) => {
  const results = [];
  render(<ConfirmProvider><Harness opts={opts} onResult={(r) => results.push(r)} /></ConfirmProvider>);
  fireEvent.click(screen.getByText("open"));
  return results;
};

describe("ConfirmDialog (replaces the browser's confirm/alert)", () => {
  it("is announced as a dialog with its title", () => {
    setup({ title: "Delete this webhook?", danger: true, confirmText: "Delete" });
    expect(screen.getByRole("alertdialog", { name: "Delete this webhook?" })).toBeInTheDocument();
  });

  it("puts focus on Cancel for destructive actions, and Escape cancels", async () => {
    const results = setup({ title: "Delete?", danger: true, confirmText: "Delete" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
    expect(results).toEqual([false]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirms with the confirm button", async () => {
    const results = setup({ title: "Restore to v2?", confirmText: "Restore" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore" })); });
    expect(results).toEqual([true]);
  });

  it("can show a message with a single button, keeping line breaks (backup codes, changelog)", () => {
    setup({ title: "Your backup codes", message: "Store these.\n\nAAAA-1111\nBBBB-2222", confirmText: "Done", cancelText: null });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const msg = screen.getByText(/AAAA-1111/);
    expect(msg.textContent).toContain("AAAA-1111\nBBBB-2222");
    expect(msg).toHaveStyle({ whiteSpace: "pre-wrap" });
  });
});
