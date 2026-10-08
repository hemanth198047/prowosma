import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("axios", () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { saml: [] } })) } }));
vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  unwrapList: (data) => (Array.isArray(data) ? data : data?.items ?? []),
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => ({ loginWithRedirect: vi.fn() }) }));

import Login from "../../pages/Login.jsx";

describe("Login page — legal links", () => {
  it("links to the public Privacy Policy and Terms of Service (Google requires them to be reachable from the app's home page)", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });
});
