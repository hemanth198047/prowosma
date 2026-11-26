import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import vm from "node:vm";
import fs from "node:fs";

const reload = vi.fn();
beforeEach(() => {
  reload.mockReset();
  sessionStorage.clear();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

import { isChunkLoadError, reloadOnce, fetchLiveVersion, currentVersion, installStaleAppGuards } from "../../utils/staleApp";
import { ErrorFallback } from "../../components/ErrorFallback";
import UpdateBanner from "../../components/UpdateBanner";

describe("stale app guards", () => {
  it("recognises the errors a browser raises for a file of an older build", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/Meetings-abc.js"))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "Loading chunk 7 failed" })).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("reloads once, and never twice within 30 seconds (no reload loop)", () => {
    expect(reloadOnce(1000000)).toBe(true);
    expect(reloadOnce(1000000 + 5000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1000000 + 31000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reloads on a failed preload and on a failed dynamic import, but not on other errors", () => {
    installStaleAppGuards();
    window.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);
    sessionStorage.clear();
    const ev = new Event("unhandledrejection"); ev.reason = new Error("Something else"); window.dispatchEvent(ev);
    expect(reload).toHaveBeenCalledTimes(1);
    const ev2 = new Event("unhandledrejection"); ev2.reason = new TypeError("Failed to fetch dynamically imported module"); window.dispatchEvent(ev2);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reads the live build id, and ignores an HTML answer (the server's fallback page)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ version: "abc-1" }) }));
    expect(await fetchLiveVersion()).toBe("abc-1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, headers: { get: () => "text/html" }, json: async () => { throw new Error("no"); } }));
    expect(await fetchLiveVersion()).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchLiveVersion()).toBeNull();
  });
});

describe("ErrorFallback", () => {
  it("an outdated page reloads onto the new build by itself", () => {
    render(<ErrorFallback error={new TypeError("Failed to fetch dynamically imported module: /assets/Meetings-x.js")} />);
    expect(screen.getByText("Prowosma was updated.")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("any other error shows the usual message and does not reload", () => {
    render(<ErrorFallback error={new Error("boom")} />);
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("UpdateBanner", () => {
  it("appears when the server has a newer build, and stays away when it is the same", async () => {
    vi.useFakeTimers();
    const live = { v: currentVersion() };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ version: live.v }) })));
    render(<UpdateBanner />);
    await act(async () => { await vi.advanceTimersByTimeAsync(21000); });
    expect(screen.queryByText(/new version of Prowosma/)).not.toBeInTheDocument();
    live.v = "newer-build";
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(screen.getByText(/new version of Prowosma/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(reload).toHaveBeenCalled();
  });
});

describe("service worker", () => {
  // Runs public/sw.js against stand-ins for the browser, as if it were running in production.
  function load() {
    const handlers = {}; const store = new Map();
    const cache = { put: vi.fn(async (k, v) => { store.set(typeof k === "string" ? k : k.url, v); }), addAll: vi.fn(async () => {}) };
    const sandbox = {
      self: { location: { hostname: "app.example.com" }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => {}, clients: { claim: () => {} }, registration: {} },
      caches: { open: async () => cache, match: async (r) => store.get(typeof r === "string" ? r : r.url), keys: async () => [], delete: async () => true },
      URL, Response, console, clients: {},
    };
    vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), sandbox);
    const run = async (request, networkResponse) => {
      sandbox.fetch = async () => networkResponse;
      let answer; handlers.fetch({ request, respondWith: (p) => { answer = p; } });
      await answer; await new Promise((r) => setTimeout(r, 0));
    };
    return { run, store };
  }
  const req = (path, extra = {}) => ({ url: `https://app.example.com${path}`, method: "GET", mode: "no-cors", clone() { return this; }, ...extra });

  it("keeps a real script under its name", async () => {
    const { run, store } = load();
    await run(req("/assets/Meetings-abc.js"), new Response("export default 1", { status: 200, headers: { "content-type": "text/javascript" } }));
    expect(store.has("https://app.example.com/assets/Meetings-abc.js")).toBe(true);
  });

  it("never keeps the app's HTML page under the name of a missing script", async () => {
    const { run, store } = load();
    await run(req("/assets/Meetings-old.js"), new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(store.has("https://app.example.com/assets/Meetings-old.js")).toBe(false);
  });

  it("keeps the newest page for offline use after every successful visit", async () => {
    const { run, store } = load();
    await run(req("/meetings", { mode: "navigate" }), new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(store.has("/index.html")).toBe(true);
  });
});
