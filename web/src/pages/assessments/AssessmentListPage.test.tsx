import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import AssessmentListPage from "./AssessmentListPage";

// Ticket #40: assessments are addressed by `public_id` (a UUID) end to end —
// the sequential `id` no longer appears in the response body, and every
// link this page builds (the row → invite-page navigation) must use it.
const PUBLIC_ID_1 = "44444444-4444-4444-8444-444444444441";
const PUBLIC_ID_2 = "44444444-4444-4444-8444-444444444442";
const PUBLIC_ID_3 = "44444444-4444-4444-8444-444444444443";
const PUBLIC_ID_4 = "44444444-4444-4444-8444-444444444444";

// Ticket #33 (AC33): a re-invite action on a failed session's row, and none
// on active/successfully-completed ones. MSW-backed, following the pattern
// established in AssessmentInvitePage.test.tsx.
//
// Also covers a code-review finding on #27/#29: connectivity_advisory_acknowledged
// is now exposed on latest_session (assessments_controller.rb), but nothing
// rendered it -- the parent spec (#27) explicitly calls for "a small inline
// note" on the assessor's session/monitor view. Those specs prove
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

// #41: latest_session is a *session*, addressed by public_id, not a
// sequential id -- opaque, non-numeric strings here prove the page doesn't
// secretly parse this as a number anywhere on the reinvite path.
const FAILED_SESSION_PUBLIC_ID = "session-public-100";
const NEW_SESSION_PUBLIC_ID = "session-public-101";

const failedAssessment = {
  public_id: PUBLIC_ID_1,
  name: "Backend Engineer",
  time_limit_min: 45,
  latest_session: { public_id: FAILED_SESSION_PUBLIC_ID, status: "ended", end_reason: "error" },
};

const activeAssessment = {
  public_id: PUBLIC_ID_2,
  name: "Frontend Engineer",
  time_limit_min: 30,
  latest_session: { public_id: "session-public-200", status: "active", end_reason: null },
};

const completedAssessment = {
  public_id: PUBLIC_ID_3,
  name: "QA Engineer",
  time_limit_min: 60,
  latest_session: { public_id: "session-public-300", status: "ended", end_reason: "all_covered" },
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
      http.post(`${API_BASE}/sessions/${FAILED_SESSION_PUBLIC_ID}/reinvite`, () =>
        HttpResponse.json(
          {
            session: {
              public_id: NEW_SESSION_PUBLIC_ID,
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
      http.post(`${API_BASE}/sessions/${FAILED_SESSION_PUBLIC_ID}/reinvite`, () =>
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

describe("AssessmentListPage connectivity advisory note", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  const NOTE_TEXT = /candidate continued on a weak connection/i;

  it("shows the inline note when the latest session acknowledged a connectivity advisory", async () => {
    mockAssessmentsList([
      {
        public_id: PUBLIC_ID_1,
        name: "Backend Engineer",
        time_limit_min: 45,
        latest_session: {
          public_id: "session-public-100",
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
        public_id: PUBLIC_ID_2,
        name: "Frontend Engineer",
        time_limit_min: 30,
        latest_session: {
          public_id: "session-public-200",
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
        public_id: PUBLIC_ID_3,
        name: "QA Engineer",
        time_limit_min: 60,
        latest_session: {
          public_id: "session-public-300",
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
        public_id: PUBLIC_ID_4,
        name: "Data Engineer",
        time_limit_min: 60,
        latest_session: {
          public_id: "session-public-400",
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

describe("AssessmentListPage public_id routing (#40)", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("links each row to the invite page by public_id, not sequential id", async () => {
    const user = userEvent.setup();
    mockAssessmentsList([activeAssessment]);

    render(
      <MemoryRouter initialEntries={["/assessments"]}>
        <Routes>
          <Route path="/assessments" element={<AssessmentListPage />} />
          <Route path="/assessments/:id/invite" element={<div>Invite page for {PUBLIC_ID_2}</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Frontend Engineer")).toBeInTheDocument());
    await user.click(screen.getByText("Frontend Engineer"));

    await waitFor(() =>
      expect(screen.getByText(`Invite page for ${PUBLIC_ID_2}`)).toBeInTheDocument()
    );
  });
});
