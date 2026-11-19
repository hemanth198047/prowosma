import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const loginUser = vi.fn();
vi.mock("axios", () => ({ default: { get: vi.fn(() => Promise.resolve({ data: { saml: [] } })), post: vi.fn() } }));
vi.mock("../../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() }, unwrapList: (r) => r?.data || [] }));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => ({ loginWithRedirect: vi.fn() }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ loginUser }) }));
import axios from "axios";
import Login from "../../pages/Login";

const phone = (on) => { window.matchMedia = (q) => ({ matches: on && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }); };

describe("Login - easy on phones", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); axios.post.mockRejectedValue({ response: { status: 401, data: { message: "Invalid email or password" } } }); });

  it("on a phone, 'keep me signed in' is on, and it's sent with the sign-in", async () => {
    phone(true);
    render(<MemoryRouter><Login /></MemoryRouter>);
    const box = await screen.findByRole("checkbox", { name: /Keep me signed in/ });
    expect(box).toBeChecked();
    fireEvent.change(document.querySelector('input[name="email"]'), { target: { name: "email", value: "bo@demo.test" } });
    fireEvent.change(document.querySelector('input[name="password"]'), { target: { name: "password", value: "secret" } });
    fireEvent.click(document.querySelector("button.auth-submit"));
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post.mock.calls[0][1]).toEqual({ email: "bo@demo.test", password: "secret", remember: true });
    expect(localStorage.getItem("prowosma.lastEmail")).toBe("bo@demo.test");
  });

  it("on a computer it's off by default; the last email is filled in; the password can be shown", async () => {
    phone(false);
    localStorage.setItem("prowosma.lastEmail", "asha@demo.test");
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(await screen.findByRole("checkbox", { name: /Keep me signed in/ })).not.toBeChecked();
    expect(document.querySelector('input[name="email"]').value).toBe("asha@demo.test");
    const pw = document.querySelector('input[name="password"]');
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autocomplete", "current-password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw).toHaveAttribute("type", "text");
  });
});
