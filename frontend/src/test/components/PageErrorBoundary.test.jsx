import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const report = vi.hoisted(() => vi.fn());
vi.mock("../../utils/reportError", () => ({ reportClientError: report }));
vi.mock("../../utils/staleApp", async (orig) => ({ ...(await orig()), reloadOnce: vi.fn(), freshReload: vi.fn() }));
import PageErrorBoundary from "../../components/PageErrorBoundary";
import { reloadOnce } from "../../utils/staleApp";

let explode = true;
function Bomb({ message = "boom" }) { if (explode) throw new Error(message); return <p>page is fine</p>; }
const wrap = (path, message) => <MemoryRouter><PageErrorBoundary resetKey={path}><Bomb message={message} /></PageErrorBoundary></MemoryRouter>;

describe("PageErrorBoundary", () => {
  const err = console.error;
  beforeEach(() => { explode = true; report.mockReset(); vi.mocked(reloadOnce).mockReset(); console.error = () => {}; });
  afterEach(() => { console.error = err; });

  it("keeps the failure to the page, says so in plain words, and reports it", () => {
    render(wrap("/a"));
    expect(screen.getByRole("alert")).toHaveTextContent("This page ran into a problem.");
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toBe("page");
  });

  it("'Try again' shows the page once the problem is gone", () => {
    const { rerender } = render(wrap("/a"));
    explode = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    rerender(wrap("/a"));
    expect(screen.getByText("page is fine")).toBeInTheDocument();
  });

  it("moving to another page clears the error", () => {
    const { rerender } = render(wrap("/a"));
    explode = false;
    rerender(wrap("/b"));
    expect(screen.getByText("page is fine")).toBeInTheDocument();
  });

  it("a file of an older version that is gone reloads by itself and is not reported as a bug", () => {
    render(wrap("/a", "Failed to fetch dynamically imported module: /assets/Meetings-abc.js"));
    expect(reloadOnce).toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Prowosma was updated.");
  });
});
