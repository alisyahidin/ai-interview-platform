import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    <MemoryRouter initialEntries={["/assessments/1/sessions/1/portfolio"]}>
      <Routes>
        <Route path="/assessments/:id/sessions/:sessionId/portfolio" element={<PortfolioPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const readyPortfolio = {
  id: 5,
  session_id: 1,
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
    http.get(`${API_BASE}/sessions/1`, () =>
      HttpResponse.json({
        data: {
          session: { id: 1, assessment_id: 1, invite_token: "tok", invite_url: "https://x/tok", candidate_name: "Ali", ...session },
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

    server.use(
      http.get(`${API_BASE}/vacancies`, () => HttpResponse.json({ data: { vacancies: [], meta: {} } })),
      http.get(`${API_BASE}/sessions/1/portfolio`, () =>
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
      http.get(`${API_BASE}/sessions/1/portfolio`, () =>
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
      http.get(`${API_BASE}/sessions/1/portfolio`, () =>
        HttpResponse.json({ data: { status: "generating" } })
      )
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(/generating portfolio/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry now/i })).not.toBeInTheDocument();
  });
});
