import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import FitGapReportPage from "./FitGapReportPage";

// This file proves FitGapReportPage is wired to the shared `usePolling` hook's
// stalled state (ticket #15) — it does not re-derive the hook's own backoff
// matrix, which is covered exhaustively in `src/hooks/usePolling.test.ts`.
const API_BASE = "http://localhost:3001/api/v1";

const retryMock = vi.fn();
let pollingResult: { isStalled: boolean; retry: () => void; failureCount: number; intervalMs: number } = {
  isStalled: false,
  retry: retryMock,
  failureCount: 0,
  intervalMs: 5000,
};

vi.mock("@/hooks/usePolling", () => ({
  usePolling: () => pollingResult,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/assessments/1/sessions/1/fitgap/1"]}>
      <Routes>
        <Route
          path="/assessments/:id/sessions/:sessionId/fitgap/:vacancyId"
          element={<FitGapReportPage />}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("FitGapReportPage polling wiring", () => {
  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };

    server.use(
      http.get(`${API_BASE}/sessions/1/portfolio`, () =>
        HttpResponse.json({
          data: {
            portfolio: {
              id: 1,
              session_id: 1,
              generation_status: "complete",
              skills: [],
              overrides: [],
            },
          },
        })
      ),
      // Report not generated yet — page reacts by triggering generation and
      // polling until it's ready.
      http.get(`${API_BASE}/portfolios/1/fitgap/1`, () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      ),
      http.post(`${API_BASE}/portfolios/1/fitgap`, () =>
        HttpResponse.json({ data: { status: "pending", message: "queued" } })
      )
    );
  });

  it("does not render a manual retry action while polling is healthy", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/generating fit\/gap report/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: /retry now/i })).not.toBeInTheDocument();
  });

  it("renders a manual retry action once the polling hook reports stalled, wired to retry()", async () => {
    pollingResult = { isStalled: true, retry: retryMock, failureCount: 5, intervalMs: 60000 };

    renderPage();

    const retryButton = await screen.findByRole("button", { name: /retry now/i });
    expect(
      screen.getByText(/stopped retrying automatically/i)
    ).toBeInTheDocument();

    await userEvent.click(retryButton);
    expect(retryMock).toHaveBeenCalledTimes(1);
  });
});
