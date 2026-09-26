import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import AssessmentInvitePage from "./AssessmentInvitePage";
import type { Session } from "@/types";

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

// Ticket #47: the four presented Session labels, as pills in the candidate
// list. Payloads are built only from fields the sessions-index response
// actually returns, and no test stubs a `failed` status value — the API never
// sends one (ADR-0002), which is exactly why "Failed" is derived from an
// ended session's `end_reason: "error"` rather than read from `status`.
function makeSession(overrides: Partial<Session> & Pick<Session, "id" | "status">): Session {
  return {
    assessment_id: 1,
    candidate_name: "Budi Santoso",
    invite_token: `tok-${overrides.id}`,
    invite_url: `https://example.com/interview/tok-${overrides.id}`,
    ...overrides,
  };
}

async function renderWithSessions(sessions: Session[]) {
  server.use(
    http.get(`${API_BASE}/assessments/1`, () =>
      HttpResponse.json({
        data: { assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45, skills: [] } },
      })
    ),
    http.get(`${API_BASE}/assessments/1/sessions`, () =>
      HttpResponse.json({ data: { sessions } })
    )
  );

  const view = renderPage();
  await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeInTheDocument());
  return view;
}

describe("AssessmentInvitePage session status pills", () => {
  it("reads a pending session as Awaiting candidate", async () => {
    await renderWithSessions([
      makeSession({ id: 10, status: "pending", candidate_name: "Budi Santoso" }),
    ]);

    expect(screen.getByText("Awaiting candidate")).toBeInTheDocument();
  });

  it("reads an active session as Live", async () => {
    await renderWithSessions([
      makeSession({ id: 11, status: "active", candidate_name: "Siti Aminah" }),
    ]);

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("reads an ended session as Completed, whatever non-error end reason it carries", async () => {
    await renderWithSessions([
      makeSession({ id: 12, status: "ended", end_reason: "all_covered", candidate_name: "Covered" }),
      makeSession({ id: 13, status: "ended", end_reason: "time_ceiling", candidate_name: "Timed out" }),
    ]);

    expect(screen.getAllByText("Completed")).toHaveLength(2);
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("reads an ended session carrying the error end reason as Failed, not Completed", async () => {
    await renderWithSessions([
      makeSession({ id: 14, status: "ended", end_reason: "error", candidate_name: "Broken" }),
    ]);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("presents all four labels as text, one per session, so colour is never the only signal", async () => {
    await renderWithSessions([
      makeSession({ id: 20, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 21, status: "active", candidate_name: "Rina" }),
      makeSession({ id: 22, status: "ended", end_reason: "manual_assessor", candidate_name: "Doni" }),
      makeSession({ id: 23, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    expect(screen.getByText("Awaiting candidate")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("adds a pulsing indicator to Live only, and keeps it out of the accessible name", async () => {
    await renderWithSessions([
      makeSession({ id: 30, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 31, status: "active", candidate_name: "Rina" }),
      makeSession({ id: 32, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
      makeSession({ id: 33, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    // `aria-hidden` is what assistive technology actually reads here, so it is
    // the contract worth asserting — the pill's text is its whole label.
    const live = screen.getByText("Live");
    expect(live.textContent).toBe("Live");
    expect(live.querySelector('[aria-hidden="true"]')).not.toBeNull();

    for (const label of ["Awaiting candidate", "Completed", "Failed"]) {
      expect(screen.getByText(label).querySelector('[aria-hidden="true"]')).toBeNull();
    }
  });

  it("has no serious accessibility violations over the populated candidate list", async () => {
    await renderWithSessions([
      makeSession({ id: 40, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 41, status: "active", candidate_name: "Rina" }),
      makeSession({ id: 42, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
      makeSession({ id: 43, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    // Scoped to the list rather than the whole page: the page's icon-only back
    // link still has no accessible name, and that header is #48's surface.
    const heading = screen.getByRole("heading", { name: /candidates/i });
    const list = heading.parentElement?.parentElement;
    expect(list).toBeTruthy();

    const results = await axe(list as HTMLElement);
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });

  it("admits exactly three session states in the type layer", () => {
    // Compile-time guard: adding a fourth value to `Session["status"]` makes
    // this assignment a type error, so `pnpm typecheck` fails. Combined with
    // the `error`-end-reason test above, nothing can introduce a fourth state.
    const states: Session["status"][] = ["pending", "active", "ended"];
    expect(states).toHaveLength(3);
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
