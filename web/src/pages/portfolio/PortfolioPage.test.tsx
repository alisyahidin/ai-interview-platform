import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import PortfolioPage from "./PortfolioPage";

// Proves PortfolioPage is wired to <Resource> (ticket #18): a pending/failed
// session with nothing generated yet renders the guarded "wrong-state"
// explanation instead of a blank shell (AC16), existing ready-state
// rendering is unchanged, and the page's polling is wired to the shared
// `usePolling` hook's stalled state (ticket #15). This does not re-derive
// <Resource>'s own matrix (see Resource.test.tsx) or usePolling's backoff
// schedule (see usePolling.test.ts).
const API_BASE = "http://localhost:3001/api/v1";
// #41: sessions/portfolios are addressed by public_id, not a sequential id.
const SESSION_PUBLIC_ID = "session-public-1";
const PORTFOLIO_PUBLIC_ID = "portfolio-public-5";

const retryMock = vi.fn();
let pollingResult: { isStalled: boolean; retry: () => void; failureCount: number; intervalMs: number } = {
  isStalled: false,
  retry: retryMock,
  failureCount: 0,
  intervalMs: 5000,
};
// Captures the function PortfolioPage hands to usePolling, so tests can
// manually fire a "poll tick" (simulating the real hook's timer) without
// re-deriving usePolling's own backoff schedule (covered by usePolling.test.ts).
let capturedPollFn: (() => void | Promise<void>) | null = null;

vi.mock("@/hooks/usePolling", () => ({
  usePolling: (fn: () => void | Promise<void>) => {
    capturedPollFn = fn;
    return pollingResult;
  },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/assessments/1/sessions/${SESSION_PUBLIC_ID}/portfolio`]}>
      <Routes>
        <Route path="/assessments/:id/sessions/:sessionId/portfolio" element={<PortfolioPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const readyPortfolio = {
  public_id: PORTFOLIO_PUBLIC_ID,
  session_public_id: SESSION_PUBLIC_ID,
  generation_status: "complete",
  skills: [
    {
      id: 10,
      skill_label: "React",
      is_discovered: false,
      ai_level: "L3",
      ai_confidence: "high",
      assessment_status: "assessed",
      status_reason: null,
      evidence: ["Explained hooks clearly"],
      competency_summary: "Solid grasp of component design.",
    },
  ],
  overrides: [],
};

function mockSession(session: Record<string, unknown>) {
  server.use(
    http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}`, () =>
      HttpResponse.json({
        data: {
          session: {
            public_id: SESSION_PUBLIC_ID,
            assessment_id: 1,
            invite_token: "tok",
            invite_url: "https://x/tok",
            candidate_name: "Ali",
            ...session,
          },
          assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45 },
        },
      })
    )
  );
}

describe("PortfolioPage", () => {
  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };
    capturedPollFn = null;

    server.use(
      http.get(`${API_BASE}/vacancies`, () => HttpResponse.json({ data: { vacancies: [], meta: {} } })),
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { portfolio: readyPortfolio } })
      )
    );
  });

  it("renders a guarded wrong-state explanation with a route back for a pending session", async () => {
    mockSession({ status: "pending" });

    renderPage();

    expect(await screen.findByText(/interview hasn't started yet/i)).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to sessions/i });
    expect(backLink).toHaveAttribute("href", "/assessments/1/invite");
    // The wrong-state page never fetches the portfolio content.
    expect(screen.queryByText("Portfolio Results")).not.toBeInTheDocument();
  });

  it("renders a guarded wrong-state explanation with a route back for a failed session", async () => {
    mockSession({ status: "ended", end_reason: "error" });

    renderPage();

    expect(await screen.findByText(/interview didn't complete/i)).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to sessions/i });
    expect(backLink).toHaveAttribute("href", "/assessments/1/invite");
    expect(screen.queryByText("Portfolio Results")).not.toBeInTheDocument();
  });

  it("renders the existing ready-state portfolio content for a completed session", async () => {
    mockSession({ status: "ended", end_reason: "completed" });

    renderPage();

    expect(await screen.findByText("Portfolio Results")).toBeInTheDocument();
    expect(screen.getByText("Ali")).toBeInTheDocument();
    expect(screen.getByText("Configured Skills")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText(/explained hooks clearly/i)).toBeInTheDocument();

    // Phase 3b (#23): scoped to the skill card itself (not the whole page —
    // this page's header/vacancy-picker chrome is untouched by this ticket
    // and pre-exist independently of the judgment-badge work) to prove the
    // new badge/labels introduce no serious/critical violations when
    // rendered against a real page + MSW-backed fetch, not just in
    // isolation (see SkillPortfolioCard.test.tsx for the full state matrix).
    const card = screen.getByRole("group", { name: /^react\b/i });
    const results = await axe(card);
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });

  it("renders a manual retry action once the polling hook reports stalled, wired to retry()", async () => {
    mockSession({ status: "active" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { status: "generating" } })
      )
    );
    pollingResult = { isStalled: true, retry: retryMock, failureCount: 5, intervalMs: 60000 };

    renderPage();

    const retryButton = await screen.findByRole("button", { name: /retry now/i });
    expect(screen.getByText(/stopped retrying automatically/i)).toBeInTheDocument();

    await userEvent.click(retryButton);
    expect(retryMock).toHaveBeenCalledTimes(1);
  });

  it("does not render a manual retry action while polling is healthy", async () => {
    mockSession({ status: "active" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { status: "generating" } })
      )
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(/generating portfolio/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry now/i })).not.toBeInTheDocument();
  });
});

// Failure-code-driven messaging (ticket #25 / AC15): the free-text
// `generation_error` no longer drives the branch shown to the assessor —
// `failure_code` does. Covers all four backend enum values plus `nil`
// (a pre-#22 row, or any other unrecognized value), asserting the message
// and the offered action (Retry vs Contact administrator vs the pre-#25
// generic fallback) for each, rendered against realistic MSW payloads.
describe("PortfolioPage generation-failure messaging", () => {
  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };
    capturedPollFn = null;

    server.use(http.get(`${API_BASE}/vacancies`, () => HttpResponse.json({ data: { vacancies: [], meta: {} } })));
  });

  function failedPortfolio(failureCode: string | null) {
    return {
      public_id: PORTFOLIO_PUBLIC_ID,
      session_public_id: SESSION_PUBLIC_ID,
      generation_status: "failed",
      generation_error: "boom: something went wrong upstream",
      failure_code: failureCode,
      skills: [],
      overrides: [],
    };
  }

  async function renderFailedPortfolio(failureCode: string | null) {
    mockSession({ status: "ended", end_reason: "completed" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { portfolio: failedPortfolio(failureCode) } })
      )
    );
    const view = renderPage();
    await screen.findByText(/portfolio generation/i);
    return view;
  }

  it.each(["timeout", "upstream_error"] as const)(
    "offers a Retry action for failure_code=%s, describing a transient problem",
    async (failureCode) => {
      server.use(
        http.post(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio/regenerate`, () =>
          HttpResponse.json({ data: { message: "queued", portfolio: failedPortfolio(null) } })
        )
      );

      await renderFailedPortfolio(failureCode);

      // The free-text generation_error is not what's shown to the assessor.
      expect(screen.queryByText(/boom: something went wrong upstream/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/contact.*administrator/i)).not.toBeInTheDocument();

      const retryButton = screen.getByRole("button", { name: /retry/i });
      await userEvent.click(retryButton);

      // Retry reuses the page's existing regenerate-then-poll mechanism —
      // it flips back into the "generating" state, not a new one.
      await waitFor(() => expect(screen.getByText(/generating portfolio/i)).toBeInTheDocument());
    }
  );

  it.each(["invalid_output", "unknown"] as const)(
    "offers a Contact administrator action for failure_code=%s, with no retry offered",
    async (failureCode) => {
      await renderFailedPortfolio(failureCode);

      expect(screen.queryByText(/boom: something went wrong upstream/i)).not.toBeInTheDocument();
      expect(screen.getByText(/administrator/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    }
  );

  it("falls back to the generic failed message and a Retry action when failure_code is nil", async () => {
    server.use(
      http.post(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio/regenerate`, () =>
        HttpResponse.json({ data: { message: "queued", portfolio: failedPortfolio(null) } })
      )
    );

    await renderFailedPortfolio(null);

    expect(screen.getByText("Portfolio generation failed.")).toBeInTheDocument();
    expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(retryButton);
    await waitFor(() => expect(screen.getByText(/generating portfolio/i)).toBeInTheDocument());
  });

  it.each(["timeout", "upstream_error", "invalid_output", "unknown", null])(
    "has zero serious/critical accessibility violations for failure_code=%s",
    async (failureCode) => {
      const { container } = await renderFailedPortfolio(failureCode);

      const results = await axe(container);
      const seriousOrCritical = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical"
      );
      expect(seriousOrCritical).toEqual([]);
    }
  );

  it("announces generation completing via an ARIA live region while the assessor is on the page", async () => {
    mockSession({ status: "active" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { status: "generating" } })
      )
    );

    renderPage();
    await waitFor(() => expect(screen.getByText(/generating portfolio/i)).toBeInTheDocument());

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("");

    // Simulate the next poll tick (driven by the real usePolling hook in
    // production) observing the terminal "complete" state.
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { portfolio: readyPortfolio } })
      )
    );
    await act(async () => {
      await capturedPollFn?.();
    });

    expect(liveRegion).toHaveTextContent(/generation is complete/i);
    // The assessor stays on the same page — no navigation, no lost place.
    expect(screen.getByText("Portfolio Results")).toBeInTheDocument();
  });

  it("does not announce completion when the page loads directly onto an already-complete portfolio", async () => {
    mockSession({ status: "ended", end_reason: "completed" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({ data: { portfolio: readyPortfolio } })
      )
    );

    renderPage();

    await screen.findByText("Portfolio Results");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
