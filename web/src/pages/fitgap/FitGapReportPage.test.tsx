import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import FitGapReportPage from "./FitGapReportPage";
import type { SkillComparison } from "@/types";

// This file proves FitGapReportPage is wired to the shared `usePolling` hook's
// stalled state (ticket #15) — it does not re-derive the hook's own backoff
// matrix, which is covered exhaustively in `src/hooks/usePolling.test.ts`.
const API_BASE = "http://localhost:3001/api/v1";
// #41: sessions/portfolios are addressed by public_id, not a sequential id.
const SESSION_PUBLIC_ID = "session-public-1";
const PORTFOLIO_PUBLIC_ID = "portfolio-public-1";

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
    <MemoryRouter initialEntries={[`/assessments/1/sessions/${SESSION_PUBLIC_ID}/fitgap/1`]}>
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
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({
          data: {
            portfolio: {
              public_id: PORTFOLIO_PUBLIC_ID,
              session_public_id: SESSION_PUBLIC_ID,
              generation_status: "complete",
              skills: [],
              overrides: [],
            },
          },
        })
      ),
      // Report not generated yet — page reacts by triggering generation and
      // polling until it's ready.
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap/1`, () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      ),
      http.post(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap`, () =>
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

// Regression guard for the bug this ticket fixes: #40 stopped exposing
// Vacancy's raw sequential id anywhere, but #41 left this page's four
// vacancy-addressed calls (getFitGap/triggerFitGap/regenerateFitGap/
// exportPortfolio) running the route's `:vacancyId` param through
// `Number(...)` — which produces `NaN` for a public_id (a UUID-shaped
// string), breaking every one of them. These specs prove the actual
// requests this page sends carry the vacancy's public_id string verbatim.
describe("FitGapReportPage vacancy id request shape", () => {
  const VACANCY_PUBLIC_ID = "vacancy-public-77";

  function renderPageForVacancy(vacancyId: string) {
    return render(
      <MemoryRouter initialEntries={[`/assessments/1/sessions/${SESSION_PUBLIC_ID}/fitgap/${vacancyId}`]}>
        <Routes>
          <Route
            path="/assessments/:id/sessions/:sessionId/fitgap/:vacancyId"
            element={<FitGapReportPage />}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };

    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({
          data: {
            portfolio: {
              public_id: PORTFOLIO_PUBLIC_ID,
              session_public_id: SESSION_PUBLIC_ID,
              generation_status: "complete",
              skills: [],
              overrides: [],
            },
          },
        })
      )
    );
  });

  it("fetches the report using the vacancy's public_id verbatim, not a coerced number", async () => {
    let requestedVacancyId: string | null = null;
    server.use(
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap/:vacancyId`, ({ params }) => {
        requestedVacancyId = params.vacancyId as string;
        return HttpResponse.json({
          data: {
            report: {
              id: 1,
              portfolio_public_id: PORTFOLIO_PUBLIC_ID,
              vacancy_public_id: VACANCY_PUBLIC_ID,
              skill_comparisons: [],
              culture_narrative: "c",
              overall_narrative: "o",
              generated_at: "2026-01-01T00:00:00.000Z",
            },
          },
        });
      })
    );

    renderPageForVacancy(VACANCY_PUBLIC_ID);

    await waitFor(() => expect(requestedVacancyId).toBe(VACANCY_PUBLIC_ID));
    expect(requestedVacancyId).not.toBe("NaN");
  });

  it("triggers generation using the vacancy's public_id verbatim when no report exists yet", async () => {
    let triggeredVacancyId: string | null = null;
    server.use(
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap/:vacancyId`, () =>
        HttpResponse.json({ error: "not_found" }, { status: 404 })
      ),
      http.post(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap`, async ({ request }) => {
        const body = (await request.json()) as { fitgap: { vacancy_id: string } };
        triggeredVacancyId = body.fitgap.vacancy_id;
        return HttpResponse.json({ data: { status: "pending", message: "queued" } });
      })
    );

    renderPageForVacancy(VACANCY_PUBLIC_ID);

    await waitFor(() => expect(triggeredVacancyId).toBe(VACANCY_PUBLIC_ID));
    expect(triggeredVacancyId).not.toBe("NaN");
  });

  function mockReportReady() {
    server.use(
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap/:vacancyId`, () =>
        HttpResponse.json({
          data: {
            report: {
              id: 1,
              portfolio_public_id: PORTFOLIO_PUBLIC_ID,
              vacancy_public_id: VACANCY_PUBLIC_ID,
              skill_comparisons: [],
              culture_narrative: "c",
              overall_narrative: "o",
              generated_at: "2026-01-01T00:00:00.000Z",
            },
          },
        })
      )
    );
  }

  it("regenerates using the vacancy's public_id verbatim", async () => {
    let regeneratedVacancyId: string | null = null;
    mockReportReady();
    server.use(
      http.post(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/regenerate_fitgap`, async ({ request }) => {
        const body = (await request.json()) as { vacancy_id: string };
        regeneratedVacancyId = body.vacancy_id;
        return HttpResponse.json({ data: { status: "pending", message: "queued" } });
      })
    );

    renderPageForVacancy(VACANCY_PUBLIC_ID);

    const regenerateButton = await screen.findByRole("button", { name: /regenerate/i });
    await userEvent.click(regenerateButton);
    await waitFor(() => expect(regeneratedVacancyId).toBe(VACANCY_PUBLIC_ID));
    expect(regeneratedVacancyId).not.toBe("NaN");
  });

  it("exports using the vacancy's public_id verbatim", async () => {
    let exportedVacancyId: string | null = null;
    mockReportReady();
    server.use(
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/export`, ({ request }) => {
        exportedVacancyId = new URL(request.url).searchParams.get("vacancy_id");
        return HttpResponse.json({ exported_at: "now", portfolio: {} });
      })
    );

    renderPageForVacancy(VACANCY_PUBLIC_ID);

    const jsonButton = await screen.findByRole("button", { name: /json/i });
    await userEvent.click(jsonButton);
    await waitFor(() => expect(exportedVacancyId).toBe(VACANCY_PUBLIC_ID));
    expect(exportedVacancyId).not.toBe("NaN");
  });
});

// Ticket #24 (Phase 3b #3): the comparison table used to read `required_level`
// — a key the backend has never sent (F8) — so the "Required" column was
// permanently blank and the override marker never fired. #22 adds
// `is_override`/`original_level`/`assessment_status` to each row; these
// tests exercise the fixed table against realistic payloads carrying those
// fields, via this page's existing MSW seam.
describe("FitGapReportPage skill comparison table", () => {
  const baseComparisons: SkillComparison[] = [
    {
      skill_label: "Ruby on Rails",
      skill_id: "ruby-on-rails",
      candidate_level: 3,
      expected_level: 4,
      result: "gap",
      delta: -1,
      confidence: "high",
      assessment_status: "assessed",
    },
    {
      skill_label: "System Design",
      skill_id: "system-design",
      candidate_level: 2,
      expected_level: 2,
      result: "match",
      delta: 0,
      confidence: "medium",
      is_override: true,
      original_level: 4,
      assessment_status: "assessed",
    },
    {
      skill_label: "Kubernetes",
      skill_id: "kubernetes",
      candidate_level: null,
      expected_level: 3,
      result: "not_assessed",
      delta: null,
      confidence: null,
      assessment_status: "not_assessed",
    },
    {
      skill_label: "Communication",
      skill_id: "communication",
      candidate_level: 1,
      expected_level: 3,
      result: "gap",
      delta: -2,
      confidence: "low",
      assessment_status: "assessed",
    },
  ];

  function mockReportReady(report: {
    skill_comparisons: SkillComparison[];
    culture_narrative: string | null;
    overall_narrative: string;
  }) {
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/portfolio`, () =>
        HttpResponse.json({
          data: {
            portfolio: {
              public_id: PORTFOLIO_PUBLIC_ID,
              session_public_id: SESSION_PUBLIC_ID,
              generation_status: "complete",
              skills: [],
              overrides: [],
            },
          },
        })
      ),
      // Report already exists — no generation/polling involved.
      http.get(`${API_BASE}/portfolios/${PORTFOLIO_PUBLIC_ID}/fitgap/1`, () =>
        HttpResponse.json({
          data: {
            report: {
              id: 1,
              portfolio_public_id: PORTFOLIO_PUBLIC_ID,
              vacancy_public_id: "vacancy-public-1",
              generated_at: "2026-01-01T00:00:00.000Z",
              ...report,
            },
          },
        })
      )
    );
  }

  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };
    mockReportReady({
      skill_comparisons: baseComparisons,
      culture_narrative: "Sample culture narrative.",
      overall_narrative: "Sample overall narrative.",
    });
  });

  it("reads the level the backend actually sends (expected_level), fixing F8's blank Required column", async () => {
    renderPage();

    const railsRow = (await screen.findByText("Ruby on Rails")).closest("tr");
    expect(railsRow).not.toBeNull();
    // Required column must show the vacancy's expected level (L4), not be
    // blank — this is the direct regression test for the `required_level` /
    // `expected_level` key mismatch.
    expect(railsRow!).toHaveTextContent("L4");
  });

  it("shows an override marker that reveals the AI's original level via a keyboard-accessible tooltip", async () => {
    renderPage();
    await screen.findByText("System Design");

    const overrideButton = screen.getByRole("button", {
      name: /overridden by assessor.*original level/i,
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Focus alone (no click) must reveal it — keyboard operability, not just
    // mouse/click.
    fireEvent.focus(overrideButton);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/original level:\s*L4/i);

    // Escape closes it again without losing keyboard control.
    fireEvent.keyDown(overrideButton, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Click toggles it open too, for mouse/touch users.
    await userEvent.click(overrideButton);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });

  it("labels a not-assessed row clearly and excludes it from the gap count", async () => {
    renderPage();
    await screen.findByText("Kubernetes");

    const kubernetesRow = screen.getByText("Kubernetes").closest("tr");
    expect(kubernetesRow!).toHaveTextContent(/not assessed/i);

    // Named, not just tallied, in the table's own summary.
    expect(screen.getByText(/not assessed: 1 skill \(kubernetes\)/i)).toBeInTheDocument();

    // Only the high-confidence Ruby on Rails gap counts as a firm gap — the
    // low-confidence Communication row must not inflate it.
    expect(screen.getByText(/^⚠ gap: 1 skill$/i)).toBeInTheDocument();
  });

  it("renders the needs_review flag on a row alongside its real (firm) result, not instead of it (Fix 1/#21)", async () => {
    // Ticket #22/#23 threaded `assessment_status` through, but the fit/gap
    // engine used to collapse a needs_review row's result/candidate_level
    // to the not_assessed shape before this fix — this proves the row now
    // keeps its real computed result *and* shows the orthogonal flag.
    mockReportReady({
      skill_comparisons: [
        ...baseComparisons,
        {
          skill_label: "Disputed Skill",
          skill_id: "disputed",
          candidate_level: 5,
          expected_level: 3,
          result: "exceed",
          delta: 2,
          confidence: "medium",
          assessment_status: "needs_review",
        },
      ],
      culture_narrative: "Sample culture narrative.",
      overall_narrative: "Sample overall narrative.",
    });

    renderPage();

    const disputedRow = (await screen.findByText("Disputed Skill")).closest("tr");
    expect(disputedRow).not.toBeNull();
    // Real result is still shown, not swallowed into "Not assessed".
    expect(disputedRow!).toHaveTextContent(/exceeds/i);
    expect(disputedRow!).toHaveTextContent("L5");
    // ...and the needs_review flag is layered on top of it.
    expect(disputedRow!).toHaveTextContent(/needs review/i);

    // Tallied in the summary too — a needs_review skill isn't "not assessed".
    expect(screen.getByText(/needs review: 1 skill/i)).toBeInTheDocument();
  });

  it("marks a low-confidence row tentative and keeps it out of the firm gap tally", async () => {
    renderPage();
    await screen.findByText("Communication");

    const communicationRow = screen.getByText("Communication").closest("tr");
    expect(communicationRow!).toHaveTextContent(/tentative/i);

    expect(screen.getByText(/tentative: 1 skill/i)).toBeInTheDocument();
    // Firm gap tally stays at 1 (Ruby on Rails only).
    expect(screen.getByText(/^⚠ gap: 1 skill$/i)).toBeInTheDocument();
  });

  it("renders the fallback narrative's honest counts verbatim when the model call failed", async () => {
    // The narrative string itself (including counting not-assessed skills
    // honestly) is generated server-side in FitGap::Engine — out of scope
    // for this frontend ticket to construct. This proves the page displays
    // whatever fallback text the backend sends without dropping or altering
    // the not-assessed mention, which is the frontend-observable slice of
    // AC12/F33.
    mockReportReady({
      skill_comparisons: baseComparisons,
      culture_narrative: null,
      overall_narrative:
        "Candidate shows 1 skill match, 0 exceeds, 2 gaps, and 1 not assessed (Kubernetes) against role requirements.",
    });

    renderPage();

    expect(
      await screen.findByText(/1 skill match, 0 exceeds, 2 gaps, and 1 not assessed \(kubernetes\)/i)
    ).toBeInTheDocument();
  });

  it("has zero serious or critical accessibility violations", async () => {
    const { container } = renderPage();
    await screen.findByText("Ruby on Rails");

    const results = await axe(container);
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
