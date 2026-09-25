import { useRef, useState, useCallback, useEffect } from "react";
import { WS_URL } from "@/services/api";
import { getStoredToken } from "@/stores/authAtom";
import type { CoverageMap } from "@/types";

const RECONNECT_DELAYS = [1000, 2000, 4000];

/**
 * Connection lifecycle for the coverage WebSocket:
 * - "connecting": initial state, before the first successful open.
 * - "connected": socket is open.
 * - "reconnecting": the socket closed/errored and a retry (following
 *   RECONNECT_DELAYS) is scheduled or in flight.
 * - "gave-up": the full reconnect schedule was exhausted with no successful
 *   open — a real terminal state. Call `reconnect()` to try again.
 *
 * There is deliberately no timeout-based "stale" state: a quiet interview
 * can legitimately produce no coverage_update messages for a long stretch,
 * and an open socket sitting idle is not a connection problem. The only
 * things that move state out of "connected" are the socket itself closing
 * or erroring.
 */
export type CoverageConnectionState = "connecting" | "connected" | "reconnecting" | "gave-up";

interface UseCoverageWebSocketResult {
  coverageMap: CoverageMap | null;
  sessionEnded: boolean;
  sessionEndReason: string | null;
  connectionState: CoverageConnectionState;
  /**
   * Set whenever a `coverage_update` message arrives; passive metadata only
   * (e.g. "last updated Xs ago"). Never changes on connection-state
   * transitions alone.
   */
  lastUpdatedAt: Date | null;
  /**
   * Resets the reconnect attempt counter and starts a fresh connection
   * attempt. Meant to be wired to a manual retry action once the state is
   * "gave-up", though it is safe to call at any time (a no-op while a
   * connection is already open).
   */
  reconnect: () => void;
  /**
   * @deprecated Derived convenience boolean (`connectionState === "connected"`)
   * kept only so the current LiveMonitorPage consumer keeps compiling.
   * Prefer `connectionState`; LiveMonitorPage's own migration is tracked
   * separately.
   */
  isConnected: boolean;
}

export function useCoverageWebSocket(sessionId: number): UseCoverageWebSocketResult {
  const [coverageMap, setCoverageMap] = useState<CoverageMap | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionEndReason, setSessionEndReason] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<CoverageConnectionState>("connecting");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);

  const connect = useCallback(() => {
    if (!activeRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Guards against onclose *and* onerror both firing for the same
    // disconnect (as real sockets typically do — error then close) and
    // scheduling two reconnect attempts / double-counting one attempt.
    let disconnectHandled = false;

    const token = getStoredToken();
    const ws = new WebSocket(`${WS_URL}/ws/sessions/${sessionId}/coverage`);
    wsRef.current = ws;

    const handleDisconnect = () => {
      if (disconnectHandled) return;
      disconnectHandled = true;
      if (!activeRef.current) return;

      const attempt = reconnectAttemptsRef.current;
      if (attempt < RECONNECT_DELAYS.length) {
        setConnectionState("reconnecting");
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connect();
        }, RECONNECT_DELAYS[attempt]);
      } else {
        setConnectionState("gave-up");
      }
    };

    ws.onopen = () => {
      setConnectionState("connected");
      reconnectAttemptsRef.current = 0;
      if (token) ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "coverage_update") {
          setCoverageMap({ skills: msg.skills ?? [], discovered: msg.discovered ?? [] });
          setLastUpdatedAt(new Date());
        } else if (msg.type === "session_status") {
          if (msg.status === "ended") {
            setSessionEnded(true);
            setSessionEndReason(msg.end_reason ?? null);
            // Stop reconnecting once session ends
            activeRef.current = false;
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = handleDisconnect;
    ws.onerror = handleDisconnect;
  }, [sessionId]);

  const reconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    activeRef.current = true;
    setConnectionState("connecting");
    connect();
  }, [connect]);

  useEffect(() => {
    activeRef.current = true;
    connect();
    return () => {
      activeRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    coverageMap,
    sessionEnded,
    sessionEndReason,
    connectionState,
    lastUpdatedAt,
    reconnect,
    isConnected: connectionState === "connected",
  };
}
