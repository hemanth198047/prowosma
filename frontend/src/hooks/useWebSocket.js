/**
 * useWebSocket — connects to the Prowosma STOMP/WebSocket endpoint
 * and delivers live workspace events to subscribers.
 *
 * Usage:
 *   const { connected, lastEvent, subscribe } = useWebSocket();
 *
 * Requires:  npm install @stomp/stompjs sockjs-client
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { getToken } from "../api/client";

export function useWebSocket() {
  const { activeWorkspace } = useAuth();
  const [connected, setConnected]     = useState(false);
  const [lastEvent, setLastEvent]     = useState(null);
  const clientRef                      = useRef(null);
  const subscribersRef                 = useRef([]); // [{type, cb}]

  const workspaceId = activeWorkspace?.id;

  useEffect(() => {
    if (!workspaceId) return;

    let stompClient = null;
    let cancelled   = false;
    // A connection the server keeps refusing (expired token, no access) must not be retried forever.
    let stompErrors = 0;
    const MAX_CONSECUTIVE_STOMP_ERRORS = 3;

    const connect = async () => {
      try {
        // Dynamically import to avoid bundle bloat when not used
        const { Client } = await import("@stomp/stompjs");
        const SockJS      = (await import("sockjs-client")).default;

        stompClient = new Client({
          webSocketFactory: () =>
            new SockJS(`${import.meta.env.VITE_API_URL || "http://localhost:9090"}/ws`),
          connectHeaders: (() => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; })(),
          reconnectDelay: 5000,
          onConnect: () => {
            if (cancelled) return;
            stompErrors = 0;
            setConnected(true);
            // Subscribe to workspace topic
            stompClient.subscribe(
              `/topic/workspace/${workspaceId}`,
              (frame) => {
                try {
                  const event = JSON.parse(frame.body);
                  if (cancelled) return;
                  setLastEvent(event);
                  // Notify specific type subscribers
                  subscribersRef.current.forEach(({ type, cb }) => {
                    if (!type || type === event.type || type === event.entityType) {
                      cb(event);
                    }
                  });
                } catch (e) { console.warn("WS parse error", e); }
              }
            );
          },
          onDisconnect: () => { if (!cancelled) setConnected(false); },
          onStompError: (frame) => {
            console.warn("STOMP error:", frame.headers?.message);
            if (++stompErrors >= MAX_CONSECUTIVE_STOMP_ERRORS) {
              console.warn("Giving up on the WebSocket after repeated STOMP errors");
              try { stompClient.deactivate(); } catch { /* already disconnected */ }
            }
          },
        });

        stompClient.activate();
        clientRef.current = stompClient;
      } catch (e) {
        console.warn("WebSocket connection failed (STOMP libs not installed?):", e.message);
      }
    };

    // Delay connection by 100ms so React StrictMode's cleanup
    // can cancel it before the WebSocket handshake starts.
    // In production (no StrictMode) this delay is imperceptible.
    const timer = setTimeout(connect, 100);

    return () => {
      clearTimeout(timer);
      cancelled = true;
      if (stompClient) { try { stompClient.deactivate(); } catch { /* already disconnected */ } }
      setConnected(false);
      clientRef.current = null;
    };
  }, [workspaceId]);

  /**
   * Subscribe to a specific event type (or all events if type is null).
   * Returns an unsubscribe function.
   */
  const subscribe = useCallback((type, cb) => {
    const entry = { type, cb };
    subscribersRef.current.push(entry);
    return () => {
      subscribersRef.current = subscribersRef.current.filter(s => s !== entry);
    };
  }, []);

  return { connected, lastEvent, subscribe };
}
