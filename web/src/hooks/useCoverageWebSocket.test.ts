import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCoverageWebSocket } from "./useCoverageWebSocket";

// Minimal hand-rolled WebSocket mock — jsdom doesn't ship a real WebSocket
// that fires controlled open/message/close/error events, so tests drive the
// lifecycle manually via the trigger* helpers below. No WS-mocking pattern
// exists elsewhere in the repo yet (grepped `src` for one), so this is
// scoped to this spec file.
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // --- test-only helpers to drive the lifecycle ---
  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  triggerClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  triggerError() {
    this.onerror?.();
  }

  static latest(): MockWebSocket {
    const instance = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!instance) throw new Error("No MockWebSocket instance was created");
    return instance;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCoverageWebSocket", () => {
  it("starts in connecting state and moves to connected on open", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    expect(result.current.connectionState).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      MockWebSocket.latest().triggerOpen();
    });

    expect(result.current.connectionState).toBe("connected");
  });

  it("moves to reconnecting on close, then to gave-up only once the full 3-attempt schedule is exhausted", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    act(() => MockWebSocket.latest().triggerOpen());
    expect(result.current.connectionState).toBe("connected");

    // 1st failure -> reconnecting, retry scheduled at 1s
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(result.current.connectionState).toBe("reconnecting");

    // 2nd failure -> still reconnecting, not gave-up yet, retry at 2s
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(result.current.connectionState).toBe("reconnecting");

    // 3rd failure -> still reconnecting (3rd attempt in flight), retry at 4s
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(MockWebSocket.instances).toHaveLength(4);
    expect(result.current.connectionState).toBe("reconnecting");

    // 4th failure -> schedule exhausted (3 attempts made) -> gave-up
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("gave-up");

    // No further reconnect attempts are scheduled once given up.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(MockWebSocket.instances).toHaveLength(4);
    expect(result.current.connectionState).toBe("gave-up");
  });

  it("treats onerror the same as onclose for the reconnect/gave-up transition, without double-scheduling", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    act(() => MockWebSocket.latest().triggerOpen());

    // Real sockets typically fire error then close for the same failure.
    act(() => {
      MockWebSocket.latest().triggerError();
      MockWebSocket.latest().triggerClose();
    });
    expect(result.current.connectionState).toBe("reconnecting");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Only one reconnect attempt should have been scheduled, not two.
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("resets the attempt counter and starts a fresh connection when reconnect() is called from gave-up", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    act(() => MockWebSocket.latest().triggerOpen());
    act(() => MockWebSocket.latest().triggerClose());
    act(() => vi.advanceTimersByTime(1000));
    act(() => MockWebSocket.latest().triggerClose());
    act(() => vi.advanceTimersByTime(2000));
    act(() => MockWebSocket.latest().triggerClose());
    act(() => vi.advanceTimersByTime(4000));
    act(() => MockWebSocket.latest().triggerClose());

    expect(result.current.connectionState).toBe("gave-up");
    const instancesBeforeReconnect = MockWebSocket.instances.length;

    act(() => {
      result.current.reconnect();
    });

    expect(MockWebSocket.instances).toHaveLength(instancesBeforeReconnect + 1);
    expect(result.current.connectionState).toBe("connecting");

    act(() => MockWebSocket.latest().triggerOpen());
    expect(result.current.connectionState).toBe("connected");

    // Prove the attempt counter was actually reset: it should take a fresh
    // full 3-attempt schedule to reach gave-up again, not an immediate flip.
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(1000));
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(2000));
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(4000));
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("gave-up");
  });

  it("sets lastUpdatedAt only on a real coverage_update message, never on connection-state changes alone", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    expect(result.current.lastUpdatedAt).toBeNull();

    act(() => MockWebSocket.latest().triggerOpen());
    expect(result.current.lastUpdatedAt).toBeNull();

    act(() => {
      MockWebSocket.latest().triggerMessage({
        type: "coverage_update",
        skills: [{ id: "s1", name: "SQL", state: "covered", probe_count: 1 }],
        discovered: [],
      });
    });
    const firstUpdate = result.current.lastUpdatedAt;
    expect(firstUpdate).not.toBeNull();
    expect(result.current.coverageMap?.skills).toHaveLength(1);

    // Connection-state churn alone must not touch lastUpdatedAt.
    act(() => MockWebSocket.latest().triggerClose());
    expect(result.current.connectionState).toBe("reconnecting");
    expect(result.current.lastUpdatedAt).toBe(firstUpdate);

    act(() => vi.advanceTimersByTime(1000));
    act(() => MockWebSocket.latest().triggerOpen());
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.lastUpdatedAt).toBe(firstUpdate);
  });

  it("never changes connection state on a long silent gap while the socket stays open (no timeout-based staleness)", () => {
    const { result } = renderHook(() => useCoverageWebSocket("42"));

    act(() => MockWebSocket.latest().triggerOpen());
    expect(result.current.connectionState).toBe("connected");

    // A long quiet stretch with no coverage_update messages, socket still open.
    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
    });

    expect(result.current.connectionState).toBe("connected");
    expect(result.current.lastUpdatedAt).toBeNull();
    // No reconnect attempts should have been triggered by the passage of time alone.
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("keeps sessionEnded/sessionEndReason and coverageMap handling intact", () => {
    const { result } = renderHook(() => useCoverageWebSocket("7"));

    act(() => MockWebSocket.latest().triggerOpen());
    act(() => {
      MockWebSocket.latest().triggerMessage({
        type: "session_status",
        status: "ended",
        end_reason: "completed",
      });
    });

    expect(result.current.sessionEnded).toBe(true);
    expect(result.current.sessionEndReason).toBe("completed");
  });
});
