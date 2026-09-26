import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import AssessmentListPage from "./AssessmentListPage";

// Code-review finding on #27/#29: connectivity_advisory_acknowledged is now
// exposed on latest_session (assessments_controller.rb), but nothing
// rendered it -- the parent spec (#27) explicitly calls for "a small inline
// note" on the assessor's session/monitor view. These specs prove
// AssessmentListPage's SessionSummary shows that note when the field is set,
// and stays silent when it's null, independent of the session's status.
const API_BASE = "http://localhost:3001/api/v1";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/assessments"]}>
      <Routes>
        <Route path="/assessments" element={<AssessmentListPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockAssessmentsList(assessments: unknown[]) {
  server.use(
    http.get(`${API_BASE}/assessments`, () =>
      HttpResponse.json({
        data: {
          assessments,
          meta: { current_page: 1, total_pages: 1, total_count: assessments.length, per_page: 20 },
        },
      })
    )
  );
}

const NOTE_TEXT = /candidate continued on a weak connection/i;

describe("AssessmentListPage connectivity advisory note", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("shows the inline note when the latest session acknowledged a connectivity advisory", async () => {
    mockAssessmentsList([
      {
        id: 1,
        name: "Backend Engineer",
        time_limit_min: 45,
        latest_session: {
          id: 100,
          status: "active",
          end_reason: null,
          connectivity_advisory_acknowledged: "2026-09-26T10:00:00.000Z",
        },
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());
    expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
  });

  it("does not show the note when the field is null", async () => {
    mockAssessmentsList([
      {
        id: 2,
        name: "Frontend Engineer",
        time_limit_min: 30,
        latest_session: {
          id: 200,
          status: "active",
          end_reason: null,
          connectivity_advisory_acknowledged: null,
        },
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Frontend Engineer")).toBeInTheDocument());
    expect(screen.queryByText(NOTE_TEXT)).not.toBeInTheDocument();
  });

  it("still shows the note on a failed session (not gated to any one status)", async () => {
    mockAssessmentsList([
      {
        id: 3,
        name: "QA Engineer",
        time_limit_min: 60,
        latest_session: {
          id: 300,
          status: "ended",
          end_reason: "error",
          connectivity_advisory_acknowledged: "2026-09-26T10:00:00.000Z",
        },
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Last: failed")).toBeInTheDocument());
    expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
  });

  it("still shows the note on a successfully completed session", async () => {
    mockAssessmentsList([
      {
        id: 4,
        name: "Data Engineer",
        time_limit_min: 60,
        latest_session: {
          id: 400,
          status: "ended",
          end_reason: "all_covered",
          connectivity_advisory_acknowledged: "2026-09-26T10:00:00.000Z",
        },
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText("Last: completed")).toBeInTheDocument());
    expect(screen.getByText(NOTE_TEXT)).toBeInTheDocument();
  });
});
