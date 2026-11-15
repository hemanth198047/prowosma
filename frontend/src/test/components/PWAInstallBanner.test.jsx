import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

vi.mock("../../hooks/usePWA", () => ({
  usePWA: () => ({ canInstall: true, isInstalled: false, promptInstall: vi.fn() }),
}));
vi.mock("../../components/PushNotificationToggle", () => ({ default: () => null }));
import PWAInstallBanner from "../../components/PWAInstallBanner";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("PWAInstallBanner", () => {
  it("never opens by itself — not on load, not after a while, not on a later visit", () => {
    vi.useFakeTimers();
    localStorage.removeItem("pwa-banner-dismissed");
    localStorage.setItem("pwa-visit-count", "5");
    render(<PWAInstallBanner />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole("heading", { name: "Install Prowosma" })).toBeNull();
  });

  it("opens when someone chooses Install App from the user menu", () => {
    render(<PWAInstallBanner />);
    act(() => { window.dispatchEvent(new CustomEvent("prowosma:show-install")); });
    expect(screen.getByRole("heading", { name: "Install Prowosma" })).toBeInTheDocument();
  });
});
