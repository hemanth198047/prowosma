/**
 * The server now refuses unauthenticated STOMP connections and checks that you belong to
 * the workspace / document you subscribe to. That only works if BOTH WebSocket hooks send
 * the JWT on CONNECT — useDocCollab used to send none, so real-time docs would break the
 * moment the server started refusing anonymous connections — and if a connection the
 * server keeps refusing is eventually given up on instead of being retried forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@stomp/stompjs", () => ({
  Client: class {
    constructor(config) {
      this.config = config;
      this.activate = vi.fn();
      this.deactivate = vi.fn();
      this.subscribe = vi.fn();
      this.publish = vi.fn();
      (globalThis.__stompClients ||= []).push(this);
    }
  },
}));
vi.mock("sockjs-client", () => ({ default: class { constructor(url) { this.url = url; } } }));
vi.mock("../../api/client", () => ({ getToken: vi.fn(() => "jwt-123") }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ activeWorkspace: { id: "ws-1" } }) }));

import { getToken } from "../../api/client";
import { useDocCollab } from "../../hooks/useDocCollab";
import { useWebSocket } from "../../hooks/useWebSocket";

const stompError = { headers: { message: "Access denied" } };

beforeEach(() => {
  globalThis.__stompClients = [];
  getToken.mockReturnValue("jwt-123");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("useDocCollab", () => {
  it("sends the JWT as a STOMP connect header", () => {
    renderHook(() => useDocCollab("doc-1", "alice"));
    const [client] = globalThis.__stompClients;
    expect(client.config.connectHeaders).toEqual({ Authorization: "Bearer jwt-123" });
    expect(client.activate).toHaveBeenCalled();
  });

  it("sends no Authorization header when there is no token (and does not crash)", () => {
    getToken.mockReturnValue(null);
    renderHook(() => useDocCollab("doc-1", "alice"));
    expect(globalThis.__stompClients[0].config.connectHeaders).toEqual({});
  });

  it("gives up after three consecutive STOMP errors instead of reconnecting forever", () => {
    renderHook(() => useDocCollab("doc-1", "alice"));
    const client = globalThis.__stompClients[0];

    client.config.onStompError(stompError);
    client.config.onStompError(stompError);
    expect(client.deactivate).not.toHaveBeenCalled();

    client.config.onStompError(stompError);
    expect(client.deactivate).toHaveBeenCalledTimes(1);
  });

  it("a successful connection resets the error count", () => {
    renderHook(() => useDocCollab("doc-1", "alice"));
    const client = globalThis.__stompClients[0];

    client.config.onStompError(stompError);
    client.config.onStompError(stompError);
    act(() => client.config.onConnect());
    client.config.onStompError(stompError);
    client.config.onStompError(stompError);
    expect(client.deactivate).not.toHaveBeenCalled();
  });
});

describe("useWebSocket", () => {
  async function connectedClient() {
    renderHook(() => useWebSocket());
    await waitFor(() => expect(globalThis.__stompClients.length).toBe(1), { timeout: 2000 });
    return globalThis.__stompClients[0];
  }

  it("sends the JWT as a STOMP connect header", async () => {
    const client = await connectedClient();
    expect(client.config.connectHeaders).toEqual({ Authorization: "Bearer jwt-123" });
  });

  it("gives up after three consecutive STOMP errors instead of reconnecting forever", async () => {
    const client = await connectedClient();

    client.config.onStompError(stompError);
    client.config.onStompError(stompError);
    expect(client.deactivate).not.toHaveBeenCalled();

    client.config.onStompError(stompError);
    expect(client.deactivate).toHaveBeenCalledTimes(1);
  });
});
