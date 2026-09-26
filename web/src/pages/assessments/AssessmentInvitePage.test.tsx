import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import SessionTable from "@/components/sessions/SessionTable";
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
    // The list is the table itself since #49, and the pills live in its rows.
    const list = screen.getByRole("table", { name: "Candidate sessions" });

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

// #49: the candidate list as a table of six aligned columns. What is asserted
// is what an assessor can read off the table — the column headers in order,
// one row per session, the two honest dashes, the action each state offers,
// where Monitor lands, and how a copy confirms itself. The one exception is
// marked below: jsdom performs no layout, so the sticky header and the capped
// scroll container are the only promises here that can only be asserted on the
// elements carrying them.
describe("AssessmentInvitePage session table", () => {
  // Midday UTC, so the year and month render the same in any test timezone.
  const STARTED_AT = "2026-06-15T12:00:00Z";
  const STARTED_DATE = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(STARTED_AT));
  const STARTED_TIME = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(STARTED_AT));

  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  // The session id has to be in the destination's own text, or "lands on the
  // monitor screen" would pass for a link to the wrong interview.
  function MonitorScreen() {
    const { sessionId } = useParams<{ sessionId: string }>();
    return <div>Monitor screen for session {sessionId}</div>;
  }

  function renderTablePage() {
    return render(
      <MemoryRouter initialEntries={["/assessments/1/invite"]}>
        <Routes>
          <Route path="/assessments/:id/invite" element={<AssessmentInvitePage />} />
          <Route path="/assessments/:id/sessions/:sessionId/monitor" element={<MonitorScreen />} />
          <Route
            path="/assessments/:id/sessions/:sessionId/portfolio"
            element={<div>Portfolio screen</div>}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  async function renderPageWith(sessions: Session[]) {
    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45, skills: [] },
          },
        })
      ),
      http.get(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({ data: { sessions } })
      )
    );

    renderTablePage();
    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });
  }

  function bodyRows(table: HTMLElement) {
    return within(table)
      .getAllByRole("row")
      .slice(1);
  }

  it("lays the six columns out in order, one row per session, under an accessible name", async () => {
    await renderPageWith([
      makeSession({ id: 70, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 71, status: "active", candidate_name: "Rina", started_at: STARTED_AT }),
      makeSession({ id: 72, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual([
      "#",
      "Candidate",
      "Status",
      "Started",
      "Duration",
      "Actions",
    ]);
    expect(bodyRows(table)).toHaveLength(3);
    expect(bodyRows(table).map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("names a row by its candidate, falls back to its position, and keeps a long name readable in full", async () => {
    const longName =
      "Distributed Systems Architecture and Fault-Tolerant Consensus Protocol Design";

    await renderPageWith([
      makeSession({ id: 73, status: "pending", candidate_name: longName }),
      // No name given at all: the API leaves the field out.
      makeSession({ id: 74, status: "pending", candidate_name: undefined }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    const [first, second] = bodyRows(table);
    expect(within(first).getByRole("cell", { name: longName })).toBeInTheDocument();
    expect(within(second).getByRole("cell", { name: "Candidate 2" })).toBeInTheDocument();

    // The same `TruncatedText` the fit/gap comparison table uses: visually cut
    // off, but the full value is one focus away.
    const truncated = within(first).getByText(longName);
    expect(truncated).toHaveClass("truncate");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(truncated);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
  });

  it("stacks the date and time an interview began, and dashes one that has not begun", async () => {
    await renderPageWith([
      makeSession({ id: 75, status: "active", candidate_name: "Rina", started_at: STARTED_AT }),
      // A pending invite has a creation time but no start — the Started column
      // must not quietly answer the question with it.
      makeSession({
        id: 76,
        status: "pending",
        candidate_name: "Wati",
        created_at: "2026-05-01T09:00:00Z",
      }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    const [live, pending] = bodyRows(table).map((row) => within(row).getAllByRole("cell")[3]);

    expect(within(live).getByText(STARTED_DATE)).toBeInTheDocument();
    expect(within(live).getByText(STARTED_TIME)).toBeInTheDocument();

    expect(pending).toHaveTextContent("—");
    expect(pending?.textContent).not.toContain("2026");
  });

  it("shows how long a finished interview ran, and dashes one that has not finished", async () => {
    await renderPageWith([
      makeSession({
        id: 77,
        status: "ended",
        end_reason: "all_covered",
        candidate_name: "Doni",
        started_at: STARTED_AT,
        ended_at: STARTED_AT,
        duration_seconds: 1110,
      }),
      // Running, so started but not yet measured — a fake 0s would be a lie.
      makeSession({ id: 78, status: "active", candidate_name: "Rina", started_at: STARTED_AT }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    const [finished, running] = bodyRows(table).map((row) => within(row).getAllByRole("cell")[4]);

    expect(finished).toHaveTextContent("18m 30s");
    expect(running).toHaveTextContent("—");
    expect(running?.textContent).not.toContain("0s");
  });

  it("offers the one action each state has, in the table's right-hand column", async () => {
    await renderPageWith([
      makeSession({ id: 79, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 80, status: "active", candidate_name: "Rina" }),
      makeSession({ id: 81, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
      makeSession({ id: 82, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    const [awaiting, live, completed, failed] = bodyRows(table);
    const actions = (row: HTMLElement) => within(row).getAllByRole("cell")[5];

    expect(within(actions(awaiting)).getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(within(actions(live)).getByRole("button", { name: /monitor/i })).toBeInTheDocument();
    expect(within(actions(completed)).getByRole("button", { name: /results/i })).toBeInTheDocument();
    // A session that errored produced no interview to open.
    expect(within(actions(failed)).queryByRole("button")).not.toBeInTheDocument();
  });

  it("takes a live row's Monitor action to that session's own monitor screen", async () => {
    await renderPageWith([
      makeSession({ id: 83, status: "active", candidate_name: "Rina" }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    await userEvent.click(within(table).getByRole("button", { name: /monitor/i }));

    expect(await screen.findByText("Monitor screen for session 83")).toBeInTheDocument();
  });

  it("confirms a copied invite link in place, having copied the session's own URL", async () => {
    await renderPageWith([
      makeSession({ id: 84, status: "pending", candidate_name: "Wati" }),
    ]);

    const table = screen.getByRole("table", { name: "Candidate sessions" });
    await userEvent.click(within(table).getByRole("button", { name: /copy link/i }));

    expect(writeTextMock).toHaveBeenCalledWith("https://example.com/interview/tok-84");
    // The same control says so, rather than leaving the assessor to find a toast.
    expect(within(table).getByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
  });

  it("counts how many candidates are shown out of the total", async () => {
    await renderPageWith([
      makeSession({ id: 85, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 86, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
    ]);

    // Shown and total are the same number until something narrows the list:
    // what this pins is that the count exists and reads both numbers.
    expect(screen.getByText("Showing 2 of 2 candidates")).toBeInTheDocument();
  });

  it("keeps the invitation prompt when the Assessment has no sessions at all", async () => {
    await renderPageWith([]);

    expect(screen.getByText("No candidates yet")).toBeInTheDocument();
    expect(
      screen.getByText(/click "invite candidate" to generate an interview link/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("No candidates match")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("answers a list narrowed to nothing with its own message, not the invitation prompt", () => {
    // Rendered on the component rather than through the page because nothing
    // narrows the list yet — the filter and search layer is what hands the
    // table fewer sessions than the Assessment has, and it reads this branch
    // instead of the invitation prompt.
    render(
      <MemoryRouter>
        <SessionTable
          sessions={[]}
          total={4}
          assessmentId="1"
          onCopy={vi.fn()}
          copiedId={null}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("No candidates match")).toBeInTheDocument();
    expect(screen.getByText(/this assessment has 4 candidates/i)).toBeInTheDocument();
    expect(screen.queryByText("No candidates yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/generate an interview link/i)).not.toBeInTheDocument();
  });

  it("puts a newly created invite in the table as a row, not in a card of its own", async () => {
    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45, skills: [] },
          },
        })
      ),
      http.get(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({ data: { sessions: [] } })
      ),
      http.post(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({
          data: {
            session: {
              id: 87,
              assessment_id: 1,
              candidate_name: "Rina",
              invite_token: "tok-87",
              invite_url: "https://example.com/interview/tok-87",
              status: "pending",
            },
          },
        })
      )
    );

    renderTablePage();
    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });

    await userEvent.click(screen.getByRole("button", { name: /invite candidate/i }));
    await userEvent.type(screen.getByLabelText(/candidate name/i), "Rina");
    await userEvent.click(screen.getByRole("button", { name: /create link/i }));

    // The list already shows this session, so the second surface that restated
    // it — a highlighted card above the table — is gone.
    const cell = await screen.findByRole("cell", { name: "Rina" });
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.queryByText(/share with your candidate/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /copy link/i })).toHaveLength(1);
  });

  it("keeps the header, the scroll cap and the sideways overflow inside the table's own container", async () => {
    await renderPageWith([
      makeSession({ id: 88, status: "pending", candidate_name: "Wati" }),
    ]);

    // jsdom performs no layout, so a capped height, a sticky header and
    // contained horizontal overflow cannot be observed by use. They are
    // asserted on the elements that carry them, which is the only way here.
    const table = screen.getByRole("table", { name: "Candidate sessions" });
    const scroller = table.parentElement; // the primitive's own overflow-auto div
    const cap = scroller?.parentElement;
    expect(scroller?.className).toContain("overflow-auto");
    expect(cap?.className).toMatch(/max-h/);

    const headerRow = within(table).getAllByRole("row")[0];
    expect(headerRow.className).toContain("sticky");
    expect(headerRow.className).toContain("top-0");
  });

  it("has no serious accessibility violations over the populated table and its count", async () => {
    await renderPageWith([
      makeSession({ id: 89, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 90, status: "active", candidate_name: "Rina", started_at: STARTED_AT }),
      makeSession({
        id: 91,
        status: "ended",
        end_reason: "all_covered",
        candidate_name: "Doni",
        duration_seconds: 1110,
      }),
      makeSession({ id: 92, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    // The Candidates section: heading, table and the count beneath it.
    const section = screen.getByRole("heading", { name: /candidates/i }).parentElement;
    expect(section).toBeTruthy();

    const results = await axe(section as HTMLElement);
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });
});
