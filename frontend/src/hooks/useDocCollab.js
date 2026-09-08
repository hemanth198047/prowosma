/**
 * A-9: useDocCollab — real-time collaborative editing via STOMP/SockJS
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

const COLLAB_COLORS = [
  "#6366f1","#ec4899","#f59e0b","#10b981","#06b6d4",
  "#8b5cf6","#ef4444","#84cc16","#f97316","#14b8a6",
];

function userColor(name) {
  let hash = 0;
  for (const ch of (name || "")) hash = ((hash << 5) - hash) + ch.charCodeAt(0);
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
}

function getTabId() {
  let id = sessionStorage.getItem("__collab_tab_id__");
  if (!id) {
    id = `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    sessionStorage.setItem("__collab_tab_id__", id);
  }
  return id;
}

const WS_URL = (import.meta.env.VITE_API_URL || "http://localhost:9090") + "/ws";

export function useDocCollab(docId, currentUser) {
  const clientRef = useRef(null);
  const tabId     = useRef(getTabId());

  const [isConnected,   setIsConnected]   = useState(false);
  const [collaborators, setCollaborators] = useState([]);
  const [incomingEdit,  setIncomingEdit]  = useState(null);

  const myColor = userColor(currentUser);

  useEffect(() => {
    if (!docId || !currentUser) return;

    const myTabId = tabId.current;

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: 3000,

      onConnect: () => {
        setIsConnected(true);

        client.subscribe(`/topic/doc/${docId}`, (message) => {
          try {
            const msg = JSON.parse(message.body);
            if (msg.tabId === myTabId) return; // ignore own messages

            switch (msg.type) {
              case "PRESENCE":
                setCollaborators((msg.collaborators || []).filter(c => c.tabId !== myTabId));
                break;
              case "CURSOR":
                setCollaborators(prev =>
                  prev.map(c => c.tabId === msg.tabId ? { ...c, blockId: msg.blockId } : c)
                );
                break;
              case "EDIT":
                if (msg.content) {
                  // Use an object wrapper so React always sees a new reference
                  // even if the content string is identical to the previous edit
                  setIncomingEdit({ content: msg.content, ts: Date.now() });
                }
                break;
              default:
                break;
            }
          } catch (e) {
            console.warn("[Collab] parse error:", e);
          }
        });

        client.publish({
          destination: `/app/doc/${docId}/join`,
          body: JSON.stringify({ tabId: myTabId, user: currentUser, color: myColor }),
        });
      },

      onDisconnect: () => {
        setIsConnected(false);
        setCollaborators([]);
      },

      onStompError: (frame) => {
        console.warn("[Collab] STOMP error:", frame.headers?.message);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      if (client.connected) {
        client.publish({
          destination: `/app/doc/${docId}/leave`,
          body: JSON.stringify({ tabId: myTabId, user: currentUser }),
        });
      }
      client.deactivate();
      setIsConnected(false);
      setCollaborators([]);
    };
  }, [docId, currentUser, myColor]);

  const sendEdit = useCallback((content) => {
    const client = clientRef.current;
    if (!client?.connected || !content) return;
    client.publish({
      destination: `/app/doc/${docId}/edit`,
      body: JSON.stringify({
        tabId:   tabId.current,
        user:    currentUser,
        content,
        ts:      Date.now(),
      }),
    });
  }, [docId, currentUser]);

  const sendCursor = useCallback((blockId, rect) => {
    const client = clientRef.current;
    if (!client?.connected) return;
    client.publish({
      destination: `/app/doc/${docId}/cursor`,
      body: JSON.stringify({
        tabId: tabId.current, user: currentUser, color: myColor, blockId,
        // Include position for cursor overlay rendering
        x: rect ? Math.round(rect.left) : null,
        y: rect ? Math.round(rect.top)  : null,
      }),
    });
  }, [docId, currentUser, myColor]);

  // Inline comment helpers
  const sendInlineComment = useCallback((blockId, selectedText, comment) => {
    return { blockId, selectedText, comment, authorEmail: currentUser,
      createdAt: new Date().toISOString() };
  }, [currentUser]);

  return { isConnected, collaborators, incomingEdit, sendEdit, sendCursor,
    sendInlineComment, myColor };
}
