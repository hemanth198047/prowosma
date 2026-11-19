import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MobileTabBar from "../../components/shell/MobileTabBar";

describe("MobileTabBar", () => {
  it("has the five places people on the job use most; Menu opens the full menu", () => {
    const onMenu = vi.fn();
    render(<MemoryRouter initialEntries={["/tasks"]}><MobileTabBar onMenu={onMenu} /></MemoryRouter>);
    for (const n of ["Home", "Tasks", "Projects", "Chat"]) expect(screen.getByRole("link", { name: n })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(onMenu).toHaveBeenCalled();
  });

  it("people with restricted access don't get Home", () => {
    render(<MemoryRouter><MobileTabBar onMenu={() => {}} restricted /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  });
});
