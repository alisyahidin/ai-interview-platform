import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import LiveMonitorPage from "./LiveMonitorPage";

// This file proves LiveMonitorPage's wiring (ticket #19) — it does not
// re-derive `<Resource>`'s own state matrix (Resource.test.tsx),
// `useCoverageWebSocket`'s own reconnect schedule (useCoverageWebSocket.test.ts),
// or `usePolling`'s own backoff matrix (usePolling.test.ts).

const API_BASE = "http://localhost:3001/api/v1";

// Transcript polling's own backoff/stall behavior is covered exhaustively in
// usePolling.test.ts; here we only prove LiveMonitorPage wires the stalled
// flag to a visible manual retry action, following the same
// mock-the-hook-directly pattern FitGapReportPage.test.tsx uses for the same
// hook (ticket #15).
const pollingRetryMock = vi.fn();
let pollingResult: { isStalled: boolean; retry: () => void; failureCount: number; intervalMs: number } = {
  isStalled: false,
  retry: pollingRetryMock,
  failureCount: 0,
  intervalMs: 3000,
};
vi.mock("@/hooks/usePolling", () => ({
  usePolling: () => pollingResult,
}));

// Minimal hand-rolled WebSocket mock — same pattern as
// useCoverageWebSocket.test.ts (no shared WS-mocking utility exists in the
// repo yet). Used here (unmocked hook) to prove the real gating/state-machine
// wiring, not just that a mocked hook renders some copy.
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState: number = MockWebSocket.CONNECTING;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send() {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

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

  static latest(): MockWebSocket {
    const instance = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!instance) throw new Error("No MockWebSocket instance was created");
    return instance;
  }
}

function mockSession(status: "pending" | "active" | "ended") {
  server.use(
    http.get(`${API_BASE}/sessions/1`, () =>
      HttpResponse.json({
        data: {
          session: {
            id: 1,
            assessment_id: 1,
            invite_token: "tok-1",
            invite_url: "https://example.com/invite/tok-1",
            status,
            started_at: status === "active" ? new Date().toISOString() : undefined,
          },
          assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45 },
        },
      })
    ),
    http.get(`${API_BASE}/sessions/1/transcript`, () =>
      HttpResponse.json({ data: { turns: [], total: 0 } })
    )
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/assessments/1/sessions/1/monitor"]}>
      <Routes>
        <Route path="/assessments/:id/sessions/:sessionId/monitor" element={<LiveMonitorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  pollingResult = { isStalled: false, retry: pollingRetryMock, failureCount: 0, intervalMs: 3000 };
  pollingRetryMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LiveMonitorPage — Resource wiring + WebSocket gating", () => {
  it("never opens a WebSocket connection for an ended (non-active) session", async () => {
    mockSession("ended");
    renderPage();

    expect(await screen.findByText(/this session has ended/i)).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("never opens a WebSocket connection for a pending (non-active) session", async () => {
    mockSession("pending");
    renderPage();

    expect(await screen.findByText(/hasn't started yet/i)).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("opens exactly one WebSocket for an active session", async () => {
    mockSession("active");
    renderPage();

    expect(await screen.findByText(/connecting/i)).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe("LiveMonitorPage — connection-state copy", () => {
  it("shows 'Live' plus passive last-updated metadata once connected", async () => {
    mockSession("active");
    renderPage();
    await screen.findByText(/connecting/i);

    act(() => MockWebSocket.latest().triggerOpen());
    act(() => {
      MockWebSocket.latest().triggerMessage({
        type: "coverage_update",
        skills: [],
        discovered: [],
      });
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/last updated \d+s ago/i)).toBeInTheDocument();
  });

  it("shows a reconnecting label when the socket drops", async () => {
    mockSession("active");
    renderPage();
    await screen.findByText(/connecting/i);
    act(() => MockWebSocket.latest().triggerOpen());

    act(() => MockWebSocket.latest().triggerClose());

    expect(await screen.findByText(/reconnecting/i)).toBeInTheDocument();
  });

  it("shows a gave-up state with a working manual Reconnect action once retries are exhausted", async () => {
    vi.useFakeTimers();
    mockSession("active");
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => MockWebSocket.latest().triggerOpen());

    // Exhaust the reconnect schedule (1s / 2s / 4s), same as
    // useCoverageWebSocket.test.ts drives the hook directly.
    act(() => MockWebSocket.latest().triggerClose());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => MockWebSocket.latest().triggerClose());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => MockWebSocket.latest().triggerClose());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    act(() => MockWebSocket.latest().triggerClose());

    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    const reconnectButton = screen.getByRole("button", { name: /reconnect/i });

    const instancesBeforeReconnect = MockWebSocket.instances.length;
    await act(async () => {
      reconnectButton.click();
    });

    expect(MockWebSocket.instances).toHaveLength(instancesBeforeReconnect + 1);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });
});

describe("LiveMonitorPage — transcript polling wiring", () => {
  it("does not render a manual retry action while polling is healthy", async () => {
    mockSession("active");
    renderPage();

    await screen.findByText(/connecting/i);
    expect(screen.queryByRole("button", { name: /retry now/i })).not.toBeInTheDocument();
  });

  it("renders a manual retry action once the polling hook reports stalled, wired to retry()", async () => {
    pollingResult = { isStalled: true, retry: pollingRetryMock, failureCount: 5, intervalMs: 60000 };
    mockSession("active");
    renderPage();

    const retryButton = await screen.findByRole("button", { name: /retry now/i });
    expect(screen.getByText(/stopped retrying automatically/i)).toBeInTheDocument();

    await userEvent.click(retryButton);
    expect(pollingRetryMock).toHaveBeenCalledTimes(1);
  });
});
