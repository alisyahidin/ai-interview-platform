import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
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

// The callback the page hands the hook, captured rather than scheduled, so no
// page test exercises backoff. It is here for the one case that needs a refresh
// to land: the fresh-invite highlight has to react to what *polling* reports,
// and inviting is the only other writer of the session list.
let pollOnce: (() => void) | null = null;

vi.mock("@/hooks/usePolling", () => ({
  usePolling: (refresh: () => void) => {
    pollOnce = refresh;
    return pollingResult;
  },
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

// The status vocabulary now appears in two places on the page: on the pill in a
// row, and on the card and tab that count and filter by that status. These
// cases are about the pill, so they look inside the table rather than at the
// page — the same assertion, aimed at the row.
function pills() {
  return within(screen.getByRole("table", { name: "Candidate sessions" }));
}

describe("AssessmentInvitePage session status pills", () => {
  it("reads a pending session as Awaiting candidate", async () => {
    await renderWithSessions([
      makeSession({ id: 10, status: "pending", candidate_name: "Budi Santoso" }),
    ]);

    expect(pills().getByText("Awaiting candidate")).toBeInTheDocument();
  });

  it("reads an active session as Live", async () => {
    await renderWithSessions([
      makeSession({ id: 11, status: "active", candidate_name: "Siti Aminah" }),
    ]);

    expect(pills().getByText("Live")).toBeInTheDocument();
  });

  it("reads an ended session as Completed, whatever non-error end reason it carries", async () => {
    await renderWithSessions([
      makeSession({ id: 12, status: "ended", end_reason: "all_covered", candidate_name: "Covered" }),
      makeSession({ id: 13, status: "ended", end_reason: "time_ceiling", candidate_name: "Timed out" }),
    ]);

    expect(pills().getAllByText("Completed")).toHaveLength(2);
    expect(pills().queryByText("Failed")).not.toBeInTheDocument();
  });

  it("reads an ended session carrying the error end reason as Failed, not Completed", async () => {
    await renderWithSessions([
      makeSession({ id: 14, status: "ended", end_reason: "error", candidate_name: "Broken" }),
    ]);

    expect(pills().getByText("Failed")).toBeInTheDocument();
    expect(pills().queryByText("Completed")).not.toBeInTheDocument();
  });

  it("presents all four labels as text, one per session, so colour is never the only signal", async () => {
    await renderWithSessions([
      makeSession({ id: 20, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 21, status: "active", candidate_name: "Rina" }),
      makeSession({ id: 22, status: "ended", end_reason: "manual_assessor", candidate_name: "Doni" }),
      makeSession({ id: 23, status: "ended", end_reason: "error", candidate_name: "Agus" }),
    ]);

    expect(pills().getByText("Awaiting candidate")).toBeInTheDocument();
    expect(pills().getByText("Live")).toBeInTheDocument();
    expect(pills().getByText("Completed")).toBeInTheDocument();
    expect(pills().getByText("Failed")).toBeInTheDocument();
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
    const live = pills().getByText("Live");
    expect(live.textContent).toBe("Live");
    expect(live.querySelector('[aria-hidden="true"]')).not.toBeNull();

    for (const label of ["Awaiting candidate", "Completed", "Failed"]) {
      expect(pills().getByText(label).querySelector('[aria-hidden="true"]')).toBeNull();
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

  it("answers a list narrowed to nothing with its own message, not the invitation prompt", async () => {
    await renderPageWith([
      makeSession({ id: 93, status: "pending", candidate_name: "Wati" }),
      makeSession({ id: 94, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
    ]);

    // Nothing narrows the list on its own: the filter and search layer hands
    // the table fewer sessions than the Assessment has, and it reads this
    // branch rather than the invitation prompt.
    await userEvent.type(
      screen.getByRole("textbox", { name: /search candidates/i }),
      "zzz"
    );

    expect(screen.getByText("No candidates match")).toBeInTheDocument();
    expect(screen.getByText(/this assessment has 2 candidates/i)).toBeInTheDocument();
    expect(screen.queryByText("No candidates yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/generate an interview link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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

// #50: the summary layer above the table — four count cards and five filter
// tabs over one selection, a name search that composes with it, and a fresh
// invite marked as a row rather than a surface of its own.
//
// The cards and the tabs deliberately share their words, so both are read
// through their own group rather than off the page: a card's "Live 1" and the
// tab's "Live 1" are the same fact said twice, and which one a test means is
// the question the group answers.
describe("AssessmentInvitePage cohort summary", () => {
  // One session per presented status, so every count in the layer is non-zero
  // and a count that moves can only have moved for one of these reasons.
  const COHORT = () => [
    makeSession({ id: 100, status: "pending", candidate_name: "Wati" }),
    makeSession({ id: 101, status: "pending", candidate_name: "Sari" }),
    makeSession({ id: 102, status: "active", candidate_name: "Rina" }),
    makeSession({ id: 103, status: "ended", end_reason: "all_covered", candidate_name: "Doni" }),
    makeSession({ id: 104, status: "ended", end_reason: "error", candidate_name: "Agus" }),
  ];

  function cardsGroup() {
    return screen.getByRole("group", { name: "Candidate summary" });
  }
  function cards() {
    return within(cardsGroup());
  }
  function tabs() {
    return within(screen.getByRole("group", { name: "Filter by status" }));
  }
  function card(name: string) {
    return cards().getByRole("button", { name });
  }
  function tab(name: string) {
    return tabs().getByRole("button", { name });
  }
  function table() {
    return screen.getByRole("table", { name: "Candidate sessions" });
  }
  function bodyRows() {
    return within(table()).getAllByRole("row").slice(1);
  }
  function searchBox() {
    return screen.getByRole("textbox", { name: /search candidates/i });
  }

  it("counts the cohort four ways above the table", async () => {
    await renderWithSessions(COHORT());

    expect(cards().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Total candidates 5",
      "Awaiting candidate 2",
      "Live 1",
      "Completed 1",
    ]);
  });

  it("counts a zero rather than dropping the card that would have shown it", async () => {
    // A cohort with nothing live and nothing completed.
    await renderWithSessions([makeSession({ id: 105, status: "pending", candidate_name: "Wati" })]);

    expect(cards().getAllByRole("button")).toHaveLength(4);
    expect(card("Live 0")).toBeInTheDocument();
    expect(card("Completed 0")).toBeInTheDocument();
  });

  it("narrows the table from a tab, whose count is the rows behind it, and restores it from All", async () => {
    await renderWithSessions(COHORT());
    expect(bodyRows()).toHaveLength(5);

    await userEvent.click(tab("Live 1"));

    expect(bodyRows()).toHaveLength(1);
    expect(within(table()).getByRole("cell", { name: "Rina" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 5 candidates")).toBeInTheDocument();
    expect(tab("Live 1")).toHaveAttribute("aria-pressed", "true");
    expect(tab("All 5")).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(tab("All 5"));

    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText("Showing 5 of 5 candidates")).toBeInTheDocument();
  });

  it("reads a card and its tab as one selection, so neither can describe a different table", async () => {
    await renderWithSessions(COHORT());

    // The card is the shortcut to the same narrowing the tab does.
    await userEvent.click(card("Live 1"));

    expect(bodyRows()).toHaveLength(1);
    expect(card("Live 1")).toHaveAttribute("aria-pressed", "true");
    expect(card("Total candidates 5")).toHaveAttribute("aria-pressed", "false");
    expect(tab("Live 1")).toHaveAttribute("aria-pressed", "true");
    expect(tab("All 5")).toHaveAttribute("aria-pressed", "false");

    // And the tab moves the card, rather than the two keeping their own ideas.
    await userEvent.click(tab("Awaiting 2"));

    expect(card("Awaiting candidate 2")).toHaveAttribute("aria-pressed", "true");
    expect(card("Live 1")).toHaveAttribute("aria-pressed", "false");
    expect(tab("Awaiting 2")).toHaveAttribute("aria-pressed", "true");
  });

  it("reaches failed sessions from its tab, which is the only place failed is counted", async () => {
    await renderWithSessions(COHORT());

    // Broken sessions are reachable even though they get no card of their own.
    expect(cards().queryByText(/failed/i)).not.toBeInTheDocument();
    expect(tabs().getByRole("button", { name: "Failed 1" })).toBeInTheDocument();

    await userEvent.click(tab("Failed 1"));

    expect(bodyRows()).toHaveLength(1);
    expect(within(table()).getByRole("cell", { name: "Agus" })).toBeInTheDocument();
  });

  it("narrows by candidate name as the assessor types", async () => {
    await renderWithSessions(COHORT());
    expect(bodyRows()).toHaveLength(5);

    await userEvent.type(searchBox(), "in");

    expect(bodyRows()).toHaveLength(1);
    expect(within(table()).getByRole("cell", { name: "Rina" })).toBeInTheDocument();

    // A partial name is a partial name — no submit, no exact match required.
    await userEvent.type(searchBox(), "a");

    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 5 candidates")).toBeInTheDocument();
  });

  it("narrows by name and by status together, so neither replaces the other", async () => {
    await renderWithSessions(COHORT());

    await userEvent.click(tab("Live 1"));
    await userEvent.type(searchBox(), "doni");

    // Doni is completed, so a search that replaced the filter would show them.
    expect(screen.getByText("No candidates match")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), "rina");
    expect(bodyRows()).toHaveLength(1);

    // And the same the other way round: changing the status does not discard
    // the name the assessor has typed.
    await userEvent.click(tab("Completed 1"));
    expect(screen.getByText("No candidates match")).toBeInTheDocument();

    await userEvent.clear(searchBox());
    await userEvent.click(tab("All 5"));
    expect(bodyRows()).toHaveLength(5);
  });

  it("focuses the search box on `/`, but types a slash while the assessor is already typing", async () => {
    await renderWithSessions(COHORT());
    expect(searchBox()).not.toHaveFocus();

    await userEvent.keyboard("/");
    expect(searchBox()).toHaveFocus();

    // Already in a field, so the shortcut must not eat the input it is
    // supposed to make faster.
    await userEvent.type(searchBox(), "/");
    expect(searchBox()).toHaveValue("/");
  });

  it("marks a newly created invite as the first row, and stops once polling reports it started", async () => {
    const CREATED: Session = {
      id: 106,
      assessment_id: 1,
      candidate_name: "Rina",
      invite_token: "tok-106",
      invite_url: "https://example.com/interview/tok-106",
      status: "pending",
    };
    // What the endpoint reports: nothing before the invite, then the new
    // session awaiting, then — at the next poll — the same session live.
    let polled: Session[] = [];

    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45, skills: [] },
          },
        })
      ),
      http.get(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({ data: { sessions: polled } })
      ),
      http.post(`${API_BASE}/assessments/1/sessions`, () =>
        HttpResponse.json({ data: { session: CREATED } })
      )
    );

    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });

    await userEvent.click(screen.getByRole("button", { name: /invite candidate/i }));
    await userEvent.type(screen.getByLabelText(/candidate name/i), "Rina");
    await userEvent.click(screen.getByRole("button", { name: /create link/i }));

    // The row is the first one and carries the ordinary copy-link action, so
    // sharing the new link costs no more than sharing any other pending invite.
    const freshRow = (await screen.findByRole("cell", { name: "Rina" })).closest("tr");
    expect(freshRow).not.toBeNull();
    expect(within(freshRow as HTMLElement).getAllByRole("cell")[0].textContent).toBe("1");
    expect(
      within(freshRow as HTMLElement).getByRole("button", { name: /copy link/i })
    ).toBeInTheDocument();
    expect(isHighlighted(freshRow as HTMLElement)).toBe(true);

    polled = [{ ...CREATED, status: "active", started_at: "2026-06-15T12:00:00Z" }];
    await act(async () => {
      pollOnce?.();
    });

    // Polling reported the candidate had joined, so the row stops claiming to
    // be new. Nothing was scheduled to expire it.
    const joinedRow = (await screen.findByRole("cell", { name: "Rina" })).closest("tr");
    expect(isHighlighted(joinedRow as HTMLElement)).toBe(false);
    expect(within(joinedRow as HTMLElement).getByText("Live")).toBeInTheDocument();
    expect(within(joinedRow as HTMLElement).getByRole("button", { name: /monitor/i })).toBeInTheDocument();
  });

  it("has no serious accessibility violations over the summary layer", async () => {
    await renderWithSessions(COHORT());

    // The cards' group sits in the layer alongside the tabs and the search box,
    // so the layer is what a scan should cover.
    const layer = cardsGroup().parentElement;
    expect(layer).toBeTruthy();

    const results = await axe(layer as HTMLElement);
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });
});

// jsdom performs no layout, so a row's tint and its left accent — the whole of
// what marks a fresh invite — cannot be seen by use. They are asserted on the
// elements that carry them, as #49 does for the sticky header. What the test
// pins is that the row is marked after the invite and unmarked after the poll,
// which is the behaviour; the classes are where it is visible.
function isHighlighted(row: HTMLElement): boolean {
  return (
    row.className.includes("bg-primary") &&
    row.querySelector("td")?.className.includes("border-primary") === true
  );
}
