import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../i18n";
import Login from "../../pages/Login.jsx";

vi.mock("axios", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { saml: [] } })) },
}));
vi.mock("../../api/client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  unwrapList: (data) => (Array.isArray(data) ? data : data?.items ?? []),
}));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ loginWithRedirect: vi.fn() }),
}));

/**
 * Verifies the i18n setup actually works end-to-end on a real, fully
 * converted page — not just that i18next initializes without error.
 * Proves both that English renders correctly by default AND that
 * switching languages actually re-renders real UI text, which is the
 * whole point of adding this framework.
 */
describe("Login — internationalization", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en"); // reset for the next test file
  });

  it("renders real English text by default", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });
    expect(screen.getByText(/built for velocity/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@company.com")).toBeInTheDocument();
  });

  it("switching to Spanish actually re-renders the real translated text", async () => {
    await i18n.changeLanguage("es");
    render(<MemoryRouter><Login /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText("Bienvenido de nuevo")).toBeInTheDocument();
    });
    expect(screen.getByText(/hecha para la velocidad/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("tu@empresa.com")).toBeInTheDocument();
  });

  it("interpolation works — the footer year and app name are substituted, not left as literal placeholders", async () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    await waitFor(() => screen.getByText("Welcome back"));

    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`${year}.*Prowosma`))).toBeInTheDocument();
    // Regression guard: interpolation placeholders like "{{year}}" must never leak into the rendered DOM.
    expect(screen.queryByText(/\{\{/)).not.toBeInTheDocument();
  });
});
