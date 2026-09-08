/**
 * A-10: usePresence — tracks which users are currently online
 * Uses a simple polling approach against the existing STOMP connection.
 * Online = user has been active in the last 5 minutes.
 */
import { useState, useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import client from "../api/client";

const POLL_INTERVAL = 60000; // 1 minute

export function usePresence() {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const { user } = useAuth();
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    // Ping presence endpoint
    const ping = async () => {
      try {
        const res = await client.get("/team/presence");
        setOnlineUsers(res.data?.online || []);
      } catch {
        // presence polling is best-effort; a failed ping just means we skip this cycle
      }
    };

    ping();
    intervalRef.current = setInterval(ping, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [user]);

  return { onlineUsers };
}
