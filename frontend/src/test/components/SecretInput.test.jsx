import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SecretInput from "../../components/ui/SecretInput";

describe("SecretInput", () => {
  const setup = () => render(
    <>
      <label htmlFor="k">API key</label>
      <SecretInput id="k" value="sk-secret" onChange={() => {}} />
    </>,
  );

  it("is reachable by its label and is hidden until asked", () => {
    setup();
    const input = screen.getByLabelText("API key");
    // Masked: a text box drawn as dots where the browser supports it, otherwise a password field.
    expect(input.className).toContain("secret-input--masked");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("button", { name: "Show key" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Show reveals it as plain text, Hide masks it again", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    const input = screen.getByLabelText("API key");
    expect(input).toHaveAttribute("type", "text");
    expect(input.className).not.toContain("secret-input--masked");
    fireEvent.click(screen.getByRole("button", { name: "Hide key" }));
    expect(screen.getByLabelText("API key").className).toContain("secret-input--masked");
  });
});
