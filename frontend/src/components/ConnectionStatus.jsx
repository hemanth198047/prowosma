/**
 * ConnectionStatus — small indicator in topbar showing WebSocket status.
 * Green dot = connected, gray = disconnected.
 */
import { useWebSocket } from "../hooks/useWebSocket";

export default function ConnectionStatus() {
  const { connected } = useWebSocket();
  return (
    <div
      className="ws-status"
      title={connected ? "Live — real-time updates active" : "Offline — reconnecting..."}
    >
      <span className={`ws-dot ${connected ? "ws-dot-live" : "ws-dot-off"}`} />
      {connected && <span className="ws-label">Live</span>}
    </div>
  );
}
