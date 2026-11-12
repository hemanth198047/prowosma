import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pencil } from "lucide-react";
import ActionMenu from "../../components/ui/ActionMenu";

describe("ActionMenu", () => {
  const setup = () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ActionMenu label="More actions for Website" items={[
        { label: "Edit", icon: Pencil, onSelect: onEdit },
        { label: "Hidden thing", hidden: true, onSelect: vi.fn() },
        "divider",
        { label: "Delete", danger: true, onSelect: onDelete },
      ]} />,
    );
    return { onEdit, onDelete };
  };

  it("opens from its named button and lists only visible items", () => {
    setup();
    const btn = screen.getByRole("button", { name: "More actions for Website" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem").map(i => i.textContent);
    expect(items).toEqual(["Edit", "Delete"]);
    expect(screen.queryByText("Hidden thing")).toBeNull();
  });

  it("runs the chosen action and closes", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Website" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("supports the keyboard: arrows move, Escape closes and returns focus", () => {
    setup();
    const btn = screen.getByRole("button", { name: "More actions for Website" });
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    const [edit, del] = screen.getAllByRole("menuitem");
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(del).toHaveFocus();
    fireEvent.keyDown(del, { key: "ArrowDown" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("closes on a click outside", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Website" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
