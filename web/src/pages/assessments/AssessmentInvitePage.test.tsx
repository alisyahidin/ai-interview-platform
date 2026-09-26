import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import AssessmentInvitePage from "./AssessmentInvitePage";

// This file proves AssessmentInvitePage is wired to the shared `usePolling`
// hook's stalled state (ticket #15) — it does not re-derive the hook's own
// backoff matrix, which is covered exhaustively in `src/hooks/usePolling.test.ts`.
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
    <MemoryRouter initialEntries={["/assessments/1/invite"]}>
      <Routes>
        <Route path="/assessments/:id/invite" element={<AssessmentInvitePage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AssessmentInvitePage polling wiring", () => {
  beforeEach(() => {
    retryMock.mockClear();
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };

    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: {
              id: 1,
              name: "Backend Engineer",
              time_limit_min: 45,
              skills: [],
            },
          },
        })
      ),
      http.get(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({
          data: {
            sessions: [
              {
                id: 10,
                assessment_id: 1,
                invite_token: "tok",
                invite_url: "https://example.com/interview/tok",
                status: "pending",
              },
            ],
          },
        })
      )
    );
  });

  it("does not render a stalled-polling banner while polling is healthy", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry now/i })).not.toBeInTheDocument();
  });

  it("renders a stalled-polling banner with a manual retry wired to retry()", async () => {
    pollingResult = { isStalled: true, retry: retryMock, failureCount: 5, intervalMs: 60000 };

    renderPage();

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());
    expect(screen.getByText(/stopped retrying automatically/i)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /retry now/i });
    await userEvent.click(retryButton);
    expect(retryMock).toHaveBeenCalledTimes(1);
  });
});

// #48: the page header names the Assessment and carries its skills as chips.
// Only what an assessor can read is asserted — a heading, a sentence, chip
// text. The page's width cap is layout, so it is not asserted here.
describe("AssessmentInvitePage header", () => {
  // Deliberately more skills than fit on one line, so a truncating chip row
  // would drop some of them.
  const SKILLS = [
    { id: 1, skill_label: "System Design", is_custom: false, expected_level: 4, display_order: 1 },
    { id: 2, skill_label: "REST APIs", is_custom: false, expected_level: 3, display_order: 2 },
    { id: 3, skill_label: "PostgreSQL", is_custom: false, expected_level: 2, display_order: 3 },
    { id: 4, skill_label: "Kubernetes", is_custom: false, expected_level: 3, display_order: 4 },
    { id: 5, skill_label: "Observability", is_custom: false, expected_level: 1, display_order: 5 },
    { id: 6, skill_label: "Incident Response", is_custom: false, expected_level: 5, display_order: 6 },
  ];

  function renderHeaderPage() {
    return render(
      <MemoryRouter initialEntries={["/assessments/1/invite"]}>
        <Routes>
          <Route path="/assessments/:id/invite" element={<AssessmentInvitePage />} />
          <Route path="/assessments" element={<div>Assessment list</div>} />
          <Route path="/assessments/:id/edit" element={<div>Assessment edit form</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    pollingResult = { isStalled: false, retry: retryMock, failureCount: 0, intervalMs: 5000 };

    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: {
              id: 1,
              name: "Backend Engineer",
              time_limit_min: 45,
              skills: SKILLS,
            },
          },
        })
      ),
      http.get(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({ data: { sessions: [] } })
      )
    );
  });

  it("titles the page with the Assessment name and states the time limit beneath it", async () => {
    renderHeaderPage();

    const title = await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });
    expect(title).toBeInTheDocument();
    expect(screen.getByText(/45 min time limit/)).toBeInTheDocument();
  });

  it("renders every assessed skill as a chip carrying its label and expected level", async () => {
    renderHeaderPage();

    const skillRow = await screen.findByRole("list", { name: "Assessed skills" });
    const chips = within(skillRow).getAllByRole("listitem");
    expect(chips).toHaveLength(SKILLS.length);

    SKILLS.forEach(({ skill_label, expected_level }, i) => {
      expect(chips[i]).toHaveTextContent(new RegExp(`${skill_label}\\s*L${expected_level}$`));
    });
  });

  it("drops the separate skills section and the skills count line", async () => {
    renderHeaderPage();

    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });
    expect(screen.queryByText("Skills assessed")).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${SKILLS.length} skills`))).not.toBeInTheDocument();
  });

  it("keeps the back link, the Edit action and the invite dialog working", async () => {
    renderHeaderPage();

    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });

    await userEvent.click(screen.getByRole("link"));
    expect(screen.getByText("Assessment list")).toBeInTheDocument();

    renderHeaderPage();
    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });

    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByText("Assessment edit form")).toBeInTheDocument();

    renderHeaderPage();
    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });

    await userEvent.click(screen.getByRole("button", { name: /invite candidate/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/candidate name/i)).toBeInTheDocument();
  });
});
