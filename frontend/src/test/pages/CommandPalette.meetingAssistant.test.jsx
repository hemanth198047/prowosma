import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../api/tasks", () => ({ getTasks: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock("../../api/projects", () => ({ getProjects: vi.fn(() => Promise.resolve({ data: [] })) }));

import CommandPalette from "../../components/CommandPalette";
import { AccessContext } from "../../context/AccessContext";

Element.prototype.scrollIntoView = vi.fn(); // jsdom does not implement it

afterEach(cleanup);

const show = (access) => render(
  <MemoryRouter>
    {access
      ? <AccessContext.Provider value={access}><CommandPalette onClose={() => {}} onAction={() => {}} /></AccessContext.Provider>
      : <CommandPalette onClose={() => {}} onAction={() => {}} />}
  </MemoryRouter>
);

describe("Command palette — Meeting Assistant is easy to reach", () => {
  it("offers 'Go to Meeting Assistant' and 'Analyse a Meeting' straight away, without typing", () => {
    show();
    expect(screen.getByText("Go to Meeting Assistant")).toBeInTheDocument();
    expect(screen.getByText(/Analyse a Meeting/)).toBeInTheDocument();
  });

  it("does not offer it to someone who is not allowed to use it", () => {
    show({ loading: false, restricted: true, enabled: true, capabilities: [], can: (c) => c !== "USE_MEETING_ASSISTANT" });
    expect(screen.queryByText("Go to Meeting Assistant")).toBeNull();
    expect(screen.queryByText(/Analyse a Meeting/)).toBeNull();
    expect(screen.getByText("Go to Projects")).toBeInTheDocument(); // the rest of the palette is unaffected
  });
});
