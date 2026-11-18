import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { clone } = vi.hoisted(() => ({ clone: vi.fn() }));
vi.mock("../../api/projects", () => ({ cloneProject: clone }));
import CloneProjectDialog from "../../components/CloneProjectDialog";

const project = { id: "p1", name: "Diwali ad shoot" };

describe("Clone project dialog", () => {
  // No beforeEach(mockClear/mockReset): with a rejected mock, this Vitest version then reports the handled rejection as a failure.

  it("suggests '<name> (Copy)', says what is copied, and sends the trimmed name", async () => {
    clone.mockResolvedValue({ data: { id: "p2", name: "Holi ad shoot" } });
    const onCloned = vi.fn();
    render(<CloneProjectDialog project={project} onClose={() => {}} onCloned={onCloned} />);
    const input = screen.getByLabelText("New project name");
    expect(input).toHaveValue("Diwali ad shoot (Copy)");
    expect(screen.getByText(/Tasks, sub-projects, files and history/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "  Holi ad shoot " } });
    fireEvent.click(screen.getByRole("button", { name: "Clone project" }));
    await waitFor(() => expect(onCloned).toHaveBeenCalledWith({ id: "p2", name: "Holi ad shoot" }));
    expect(clone).toHaveBeenLastCalledWith("p1", "Holi ad shoot");
  });

  it("won't clone with an empty name", () => {
    render(<CloneProjectDialog project={project} onClose={() => {}} onCloned={() => {}} />);
    fireEvent.change(screen.getByLabelText("New project name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Clone project" })).toBeDisabled();
  });

  it("shows the server's reason and stays open when it fails", async () => {
    clone.mockRejectedValue(Object.assign(new Error("Request failed with status code 403"), { response: { status: 403, data: { error: "FORBIDDEN", message: "You can't create projects in this workspace." } } }));
    const onCloned = vi.fn();
    render(<CloneProjectDialog project={project} onClose={() => {}} onCloned={onCloned} />);
    fireEvent.click(screen.getByRole("button", { name: "Clone project" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You can't create projects in this workspace."));
    expect(onCloned).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clone project" })).toBeEnabled();
  });

  it("Escape and Cancel close it", () => {
    const onClose = vi.fn();
    render(<CloneProjectDialog project={project} onClose={onClose} onCloned={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
