import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { desktopAllowed, notificationUrl, requestDesktopPermission, showDesktopNotification } from "../../utils/desktopNotify";

const realNotification = globalThis.Notification;
afterEach(() => { globalThis.Notification = realNotification; vi.restoreAllMocks(); });

function fakeNotification(permission) {
  const ctor = vi.fn(function (title, opts) { this.title = title; this.opts = opts; this.close = vi.fn(); });
  ctor.permission = permission;
  ctor.requestPermission = vi.fn(async () => { ctor.permission = "granted"; return "granted"; });
  globalThis.Notification = ctor;
  return ctor;
}

describe("desktop pop-ups", () => {
  beforeEach(() => { Object.defineProperty(globalThis.navigator, "serviceWorker", { value: undefined, configurable: true }); });

  it("shows nothing until the person has allowed it", async () => {
    const N = fakeNotification("default");
    expect(desktopAllowed()).toBe(false);
    expect(await showDesktopNotification({ title: "Hi" })).toBe(false);
    expect(N).not.toHaveBeenCalled();
  });

  it("asks the browser once, and only when nobody has decided yet", async () => {
    const N = fakeNotification("default");
    expect(await requestDesktopPermission()).toBe("granted");
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    expect(await requestDesktopPermission()).toBe("granted");
    expect(N.requestPermission).toHaveBeenCalledTimes(1);
    fakeNotification("denied");
    expect(await requestDesktopPermission()).toBe("denied");
  });

  it("shows the pop-up through the service worker when there is one, with the page to open on click", async () => {
    fakeNotification("granted");
    const showNotification = vi.fn().mockResolvedValue();
    Object.defineProperty(globalThis.navigator, "serviceWorker", { value: { getRegistration: async () => ({ showNotification }) }, configurable: true });
    expect(await showDesktopNotification({ title: "You haven't clocked in", body: "Open Prowosma", url: "/attendance", tag: "t" })).toBe(true);
    expect(showNotification).toHaveBeenCalledWith("You haven't clocked in", expect.objectContaining({ body: "Open Prowosma", data: { url: "/attendance" }, tag: "t" }));
  });

  it("falls back to a plain browser notification, and never throws", async () => {
    const N = fakeNotification("granted");
    expect(await showDesktopNotification({ title: "Hello", body: "x" })).toBe(true);
    expect(N).toHaveBeenCalledWith("Hello", expect.objectContaining({ body: "x" }));
    globalThis.Notification = vi.fn(() => { throw new Error("blocked"); });
    globalThis.Notification.permission = "granted";
    expect(await showDesktopNotification({ title: "Hello" })).toBe(false);
  });

  it("sends a click to the right page", () => {
    expect(notificationUrl({ entityType: "TASK", entityId: "t 1" })).toBe("/tasks?highlight=t%201");
    expect(notificationUrl({ entityType: "GOAL", entityId: "g1" })).toBe("/goals?highlight=g1");
    expect(notificationUrl({ entityType: "SOMETHING" })).toBe("/");
    expect(notificationUrl(null)).toBe("/");
  });
});
