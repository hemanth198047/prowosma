import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useContext } from "react";

vi.mock("../../api/client", () => ({ default: { get: vi.fn() } }));
import client from "../../api/client";
import { AuthContext } from "../../context/AuthContext.js";
import { RoleContext } from "../../context/RoleContext.js";
import { RoleProvider } from "../../context/RoleContext.jsx";

// Records every render's {loading, isAdmin}, so we can see what an
// adminOnly route would have decided on each one.
const seen = [];
function Probe() {
  const r = useContext(RoleContext);
  seen.push({ loading: r.loading, isAdmin: r.isAdmin, role: r.role });
  return <div data-testid="state">{r.loading ? "loading" : `${r.role}:${r.isAdmin}`}</div>;
}
const renderWith = (auth) => render(
  <AuthContext.Provider value={auth}><RoleProvider><Probe /></RoleProvider></AuthContext.Provider>,
);

describe("RoleProvider", () => {
  beforeEach(() => { seen.length = 0; client.get.mockReset(); });

  it("never reports 'loaded, not admin' for an owner while the role is still being worked out", async () => {
    const auth = { user: { email: "o@x.com" }, activeWorkspace: { id: "w1", ownerEmail: "o@x.com" } };
    renderWith(auth);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("OWNER:true"));
    // the bug: a render with loading=false and isAdmin=false before the role arrived
    expect(seen.some(s => !s.loading && !s.isAdmin)).toBe(false);
  });

  it("stays loading when sign-in completes after the first render, until the role is looked up", async () => {
    const { rerender } = renderWith({ user: null, activeWorkspace: null });
    seen.length = 0;
    client.get.mockResolvedValue({ data: { role: "ADMIN" } });
    rerender(
      <AuthContext.Provider value={{ user: { email: "a@x.com" }, activeWorkspace: { id: "w1", ownerEmail: "o@x.com" } }}>
        <RoleProvider><Probe /></RoleProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("ADMIN:true"));
    expect(seen.some(s => !s.loading && !s.isAdmin)).toBe(false);
  });

  it("still resolves a member as not admin", async () => {
    client.get.mockResolvedValue({ data: { role: "MEMBER" } });
    renderWith({ user: { email: "m@x.com" }, activeWorkspace: { id: "w1", ownerEmail: "o@x.com" } });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("MEMBER:false"));
  });

  it("is not loading when nobody is signed in", async () => {
    renderWith({ user: null, activeWorkspace: null });
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("null:false"));
  });
});
