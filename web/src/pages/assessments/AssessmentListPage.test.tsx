import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import AssessmentListPage from "./AssessmentListPage";

// Ticket #33 (AC33): a re-invite action on a failed session's row, and none
// on active/successfully-completed ones. MSW-backed, following the pattern
// established in AssessmentInvitePage.test.tsx.
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

const failedAssessment = {
  id: 1,
  name: "Backend Engineer",
  time_limit_min: 45,
  latest_session: { id: 100, status: "ended", end_reason: "error" },
};

const activeAssessment = {
  id: 2,
  name: "Frontend Engineer",
  time_limit_min: 30,
  latest_session: { id: 200, status: "active", end_reason: null },
};

const completedAssessment = {
  id: 3,
  name: "QA Engineer",
  time_limit_min: 60,
  latest_session: { id: 300, status: "ended", end_reason: "all_covered" },
};

describe("AssessmentListPage re-invite action (#33)", () => {
  beforeEach(() => {
    mockAssessmentsList([failedAssessment, activeAssessment, completedAssessment]);
  });

  it("shows a re-invite action on a failed session and not on active or completed ones", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());

    expect(screen.getByText("Last: failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-invite/i })).toBeInTheDocument();

    expect(screen.getByText("Last: completed")).toBeInTheDocument();
    expect(screen.getByText("Live now")).toBeInTheDocument();

    // Only one re-invite button exists — not on active/completed rows.
    expect(screen.getAllByRole("button", { name: /re-invite/i })).toHaveLength(1);
  });

  it("triggering the re-invite action shows the new invite link", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API_BASE}/sessions/100/reinvite`, () =>
        HttpResponse.json(
          {
            session: {
              id: 101,
              assessment_id: 1,
              tenant_id: 1,
              candidate_id: 42,
              candidate_name: "Budi Santoso",
              invite_token: "fresh-token",
              invite_url: "http://localhost:3001/interview/fresh-token",
              status: "pending",
              end_reason: null,
            },
            invite_url: "http://localhost:3001/interview/fresh-token",
          },
          { status: 201 }
        )
      )
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /re-invite/i }));

    await waitFor(() =>
      expect(screen.getByText("http://localhost:3001/interview/fresh-token")).toBeInTheDocument()
    );
    expect(screen.getByText(/Budi Santoso/)).toBeInTheDocument();
  });

  it("handles a 422 from the backend without crashing (defensive — shouldn't normally happen given UI gating)", async () => {
    const user = userEvent.setup();

    server.use(
      http.post(`${API_BASE}/sessions/100/reinvite`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: 422,
                message: "Session can only be re-invited from a terminal failed state (status: ended, end_reason: error)",
              },
            ],
          },
          { status: 422 }
        )
      )
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /re-invite/i }));

    await waitFor(() =>
      expect(screen.getByText(/failed to re-invite candidate/i)).toBeInTheDocument()
    );

    // The page keeps rendering normally — no crash, other rows unaffected.
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
  });
});
