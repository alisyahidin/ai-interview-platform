import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useParams } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import sessionsIndex from "@/mocks/fixtures/generated/sessions_index.json";
import AssessmentInvitePage from "./AssessmentInvitePage";
import type { Session } from "@/types";

// This file proves AssessmentInvitePage is wired to the shared `usePolling`
// hook's stalled state (ticket #15) — it does not re-derive the hook's own
// backoff matrix, which is covered exhaustively in `src/hooks/usePolling.test.ts`.
const API_BASE = "http://localhost:3001/api/v1";

const retryMock = vi.fn();
let pollingResult: {
    isStalled: boolean;
    retry: () => void;
    failureCount: number;
    intervalMs: number;
} = {
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
        </MemoryRouter>,
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
                }),
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
                }),
            ),
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

// The sessions-index response, generated from the real serializer by
// `RAILS_ENV=test bundle exec rake contracts:export` in api/ and committed
// here. Every Session below is one of these five, so no case in this file can
// assert a response key the API never sends — the bug class ADR-0002 exists to
// prevent. What a case does is choose which generated Session it is talking
// about and override the fields that make its scenario different.
const CONTRACT_SESSIONS = sessionsIndex.data.sessions as Session[];

function contractSession(match: (session: Session) => boolean): Session {
    const found = CONTRACT_SESSIONS.find(match);
    if (!found) {
        throw new Error("no generated sessions-index session matches");
    }
    return found;
}

const CONTRACT = {
    awaiting: contractSession((s) => s.status === "pending" && !!s.candidate_name),
    awaitingUnnamed: contractSession((s) => s.status === "pending" && !s.candidate_name),
    live: contractSession((s) => s.status === "active"),
    completed: contractSession((s) => s.status === "ended" && s.end_reason === "all_covered"),
    failed: contractSession((s) => s.status === "ended" && s.end_reason === "error"),
};

/**
 * A generated Session carrying a test-local id. The id is the one field a case
 * may choose outright — it is an identity, not a contract fact — and the
 * scenario's own differences (the state, the name, the timestamps) ride on top
 * of a payload the API really sent.
 */
function sessionFrom(template: Session, id: number, overrides: Partial<Session> = {}): Session {
    return { ...template, id, ...overrides };
}

async function renderWithSessions(sessions: Session[]) {
    server.use(
        http.get(`${API_BASE}/assessments/1`, () =>
            HttpResponse.json({
                data: {
                    assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45, skills: [] },
                },
            }),
        ),
        http.get(`${API_BASE}/assessments/1/sessions`, () =>
            HttpResponse.json({ data: { sessions } }),
        ),
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

describe("AssessmentInvitePage session state pills", () => {
    it("reads a pending session as Awaiting candidate", async () => {
        await renderWithSessions([sessionFrom(CONTRACT.awaiting, 10)]);

        expect(pills().getByText("Awaiting candidate")).toBeInTheDocument();
    });

    it("reads an active session as Live", async () => {
        await renderWithSessions([sessionFrom(CONTRACT.live, 11)]);

        expect(pills().getByText("Live")).toBeInTheDocument();
    });

    it("reads an ended session as Completed, whatever non-error end reason it carries", async () => {
        await renderWithSessions([
            sessionFrom(CONTRACT.completed, 12, { candidate_name: "Covered" }),
            sessionFrom(CONTRACT.completed, 13, {
                candidate_name: "Timed out",
                end_reason: "time_ceiling",
            }),
        ]);

        expect(pills().getAllByText("Completed")).toHaveLength(2);
        expect(pills().queryByText("Failed")).not.toBeInTheDocument();
    });

    it("reads an ended session carrying the error end reason as Failed, not Completed", async () => {
        await renderWithSessions([sessionFrom(CONTRACT.failed, 14)]);

        expect(pills().getByText("Failed")).toBeInTheDocument();
        expect(pills().queryByText("Completed")).not.toBeInTheDocument();
    });

    it("presents all four labels as text, one per session, so colour is never the only signal", async () => {
        await renderWithSessions([
            sessionFrom(CONTRACT.awaiting, 20),
            sessionFrom(CONTRACT.live, 21),
            sessionFrom(CONTRACT.completed, 22),
            sessionFrom(CONTRACT.failed, 23),
        ]);

        expect(pills().getByText("Awaiting candidate")).toBeInTheDocument();
        expect(pills().getByText("Live")).toBeInTheDocument();
        expect(pills().getByText("Completed")).toBeInTheDocument();
        expect(pills().getByText("Failed")).toBeInTheDocument();
    });

    it("adds a pulsing indicator to Live only, and keeps it out of the accessible name", async () => {
        await renderWithSessions([
            sessionFrom(CONTRACT.awaiting, 30),
            sessionFrom(CONTRACT.live, 31),
            sessionFrom(CONTRACT.completed, 32),
            sessionFrom(CONTRACT.failed, 33),
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
            sessionFrom(CONTRACT.awaiting, 40),
            sessionFrom(CONTRACT.live, 41),
            sessionFrom(CONTRACT.completed, 42),
            sessionFrom(CONTRACT.failed, 43),
        ]);

        const list = screen.getByRole("table", { name: "Candidate sessions" });

        const results = await axe(list as HTMLElement);
        const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
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

    it("reads only fields the generated sessions-index payload actually sends", () => {
        // F8 was the frontend reading a response key the backend never sent. The
        // API is allowed to send more than the type models; it is not allowed to
        // send less, so this asserts the generated payload is a superset of every
        // declared field. `ALL_SESSION_FIELDS` is the compiler's list, so a field
        // added to `Session` without the API sending it fails here rather than at
        // runtime, and a field dropped from the API fails here too.
        const declared = Object.keys({} as { [K in keyof Required<Session>]: true });
        expect(declared.filter((key) => !(key in CONTRACT_SESSIONS[0]))).toEqual([]);
    });
});

// #48: the page header names the Assessment and carries its skills as chips.
// Only what an assessor can read is asserted — a heading, a sentence, chip
// text. The page's width cap is layout, so it is not asserted here.
describe("AssessmentInvitePage header", () => {
    // Deliberately more skills than fit on one line, so a truncating chip row
    // would drop some of them.
    const SKILLS = [
        {
            id: 1,
            skill_label: "System Design",
            is_custom: false,
            expected_level: 4,
            display_order: 1,
        },
        { id: 2, skill_label: "REST APIs", is_custom: false, expected_level: 3, display_order: 2 },
        { id: 3, skill_label: "PostgreSQL", is_custom: false, expected_level: 2, display_order: 3 },
        { id: 4, skill_label: "Kubernetes", is_custom: false, expected_level: 3, display_order: 4 },
        {
            id: 5,
            skill_label: "Observability",
            is_custom: false,
            expected_level: 1,
            display_order: 5,
        },
        {
            id: 6,
            skill_label: "Incident Response",
            is_custom: false,
            expected_level: 5,
            display_order: 6,
        },
    ];

    function renderHeaderPage() {
        return render(
            <MemoryRouter initialEntries={["/assessments/1/invite"]}>
                <Routes>
                    <Route path="/assessments/:id/invite" element={<AssessmentInvitePage />} />
                    <Route path="/assessments" element={<div>Assessment list</div>} />
                    <Route path="/assessments/:id/edit" element={<div>Assessment edit form</div>} />
                </Routes>
            </MemoryRouter>,
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
                }),
            ),
            http.get(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { sessions: [] } }),
            ),
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
                    <Route
                        path="/assessments/:id/sessions/:sessionId/monitor"
                        element={<MonitorScreen />}
                    />
                    <Route
                        path="/assessments/:id/sessions/:sessionId/portfolio"
                        element={<div>Portfolio screen</div>}
                    />
                </Routes>
            </MemoryRouter>,
        );
    }

    async function renderPageWith(sessions: Session[]) {
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
                }),
            ),
            http.get(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { sessions } }),
            ),
        );

        const view = renderTablePage();
        await screen.findByRole("heading", { level: 1, name: "Backend Engineer" });
        return view;
    }

    function bodyRows(table: HTMLElement) {
        return within(table).getAllByRole("row").slice(1);
    }

    it("lays the six columns out in order, one row per session, under an accessible name", async () => {
        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 70),
            sessionFrom(CONTRACT.live, 71, { started_at: STARTED_AT }),
            sessionFrom(CONTRACT.completed, 72),
        ]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        expect(
            within(table)
                .getAllByRole("columnheader")
                .map((head) => head.textContent),
        ).toEqual(["#", "Candidate", "Status", "Started", "Duration", "Actions"]);
        expect(bodyRows(table)).toHaveLength(3);
        // The API orders newest first, and the newest invite takes the highest
        // position: so an arriving invite does not renumber the cohort below it.
        expect(
            bodyRows(table).map((row) => within(row).getAllByRole("cell")[0].textContent),
        ).toEqual(["3", "2", "1"]);
    });

    it("names a row by its candidate, falls back to its position, and keeps a long name readable in full", async () => {
        const longName =
            "Distributed Systems Architecture and Fault-Tolerant Consensus Protocol Design";

        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 73, { candidate_name: longName }),
            // No name given at all: the API sends the field as null.
            sessionFrom(CONTRACT.awaitingUnnamed, 74),
        ]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        const [first, second] = bodyRows(table);
        expect(within(first).getByRole("cell", { name: longName })).toBeInTheDocument();
        // The fallback carries the same position the index column shows, so the two
        // never name a different candidate.
        expect(within(first).getAllByRole("cell")[0]).toHaveTextContent("2");
        expect(within(second).getByRole("cell", { name: "Candidate 1" })).toBeInTheDocument();

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
            sessionFrom(CONTRACT.live, 75, { started_at: STARTED_AT }),
            // A pending invite has a creation time but no start — the Started column
            // must not quietly answer the question with it.
            sessionFrom(CONTRACT.awaiting, 76, { created_at: "2026-05-01T09:00:00Z" }),
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
            sessionFrom(CONTRACT.completed, 77, {
                started_at: STARTED_AT,
                ended_at: STARTED_AT,
                duration_seconds: 1110,
            }),
            // Running, so started but not yet measured — a fake 0s would be a lie.
            sessionFrom(CONTRACT.live, 78, { started_at: STARTED_AT }),
        ]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        const [finished, running] = bodyRows(table).map(
            (row) => within(row).getAllByRole("cell")[4],
        );

        expect(finished).toHaveTextContent("18m 30s");
        expect(running).toHaveTextContent("—");
        expect(running?.textContent).not.toContain("0s");
    });

    it("offers the one action each state has, in the table's right-hand column", async () => {
        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 79),
            sessionFrom(CONTRACT.live, 80),
            sessionFrom(CONTRACT.completed, 81),
            sessionFrom(CONTRACT.failed, 82),
        ]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        const [awaiting, live, completed, failed] = bodyRows(table);
        const actions = (row: HTMLElement) => within(row).getAllByRole("cell")[5];

        expect(
            within(actions(awaiting)).getByRole("button", { name: /copy link/i }),
        ).toBeInTheDocument();
        expect(within(actions(live)).getByRole("button", { name: /monitor/i })).toBeInTheDocument();
        expect(
            within(actions(completed)).getByRole("button", { name: /results/i }),
        ).toBeInTheDocument();
        // A session that errored produced no interview to open.
        expect(within(actions(failed)).queryByRole("button")).not.toBeInTheDocument();
    });

    it("takes a live row's Monitor action to that session's own monitor screen", async () => {
        const live = sessionFrom(CONTRACT.live, 83);
        await renderPageWith([live]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        await userEvent.click(within(table).getByRole("button", { name: /monitor/i }));

        expect(
            await screen.findByText(`Monitor screen for session ${live.id}`),
        ).toBeInTheDocument();
    });

    it("confirms a copied invite link in place, having copied the session's own URL", async () => {
        const awaiting = sessionFrom(CONTRACT.awaiting, 84);
        await renderPageWith([awaiting]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        await userEvent.click(within(table).getByRole("button", { name: /copy link/i }));

        expect(writeTextMock).toHaveBeenCalledWith(awaiting.invite_url);
        // The same control says so, rather than leaving the assessor to find a toast.
        expect(within(table).getByRole("button", { name: /copied/i })).toBeInTheDocument();
        expect(within(table).queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();
    });

    it("announces the copied link, because a button swapping its own label says it to nobody", async () => {
        await renderPageWith([sessionFrom(CONTRACT.awaiting, 86)]);

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        // Rendered and empty before the copy: a live region that arrives at the
        // same moment as its text is not announced.
        expect(within(table).getByRole("status")).toBeEmptyDOMElement();

        await userEvent.click(within(table).getByRole("button", { name: /copy link/i }));

        expect(within(table).getByRole("status")).toHaveTextContent("Invite link copied");
    });

    it("counts how many candidates are shown out of the total", async () => {
        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 85),
            sessionFrom(CONTRACT.completed, 86),
        ]);

        // Shown and total are the same number until something narrows the list:
        // what this pins is that the count exists and reads both numbers.
        expect(screen.getByText("Showing 2 of 2 candidates")).toBeInTheDocument();
    });

    it("numbers a row by its place in the whole cohort, so narrowing never renames a candidate", async () => {
        // Newest first, as the endpoint returns it.
        await renderPageWith([
            sessionFrom(CONTRACT.live, 31, { candidate_name: "Rina" }),
            sessionFrom(CONTRACT.completed, 32, { candidate_name: "Doni" }),
            sessionFrom(CONTRACT.failed, 33, { candidate_name: "Agus" }),
            sessionFrom(CONTRACT.awaiting, 34, { candidate_name: "Sari" }),
            sessionFrom(CONTRACT.awaiting, 35, { candidate_name: "Wati" }),
        ]);

        const positions = () =>
            bodyRows(screen.getByRole("table", { name: "Candidate sessions" })).map(
                (row) => within(row).getAllByRole("cell")[0].textContent,
            );

        expect(positions()).toEqual(["5", "4", "3", "2", "1"]);

        // Narrowing keeps both waiting candidates' numbers, and they are the
        // numbers the unfiltered table already gave them: "candidate 2" does not
        // become a different person because a filter was applied.
        await userEvent.click(screen.getByRole("button", { name: "Awaiting 2" }));
        expect(positions()).toEqual(["2", "1"]);

        // And narrowing twice, by name as well, still does not move it.
        await userEvent.type(screen.getByRole("textbox", { name: /search candidates/i }), "sari");
        expect(positions()).toEqual(["2"]);

        const row = screen.getByRole("cell", { name: "Sari" }).closest("tr") as HTMLElement;
        expect(within(row).getAllByRole("cell")[0]).toHaveTextContent("2");
    });

    it("keeps the invitation prompt when the Assessment has no sessions at all", async () => {
        await renderPageWith([]);

        expect(screen.getByText("No candidates yet")).toBeInTheDocument();
        expect(
            screen.getByText(/click "invite candidate" to generate an interview link/i),
        ).toBeInTheDocument();
        expect(screen.queryByText("No candidates match")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.getByText("Showing 0 of 0 candidates")).toBeInTheDocument();
    });

    it("answers a list narrowed to nothing with its own message, not the invitation prompt", async () => {
        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 93, { candidate_name: "Wati" }),
            sessionFrom(CONTRACT.completed, 94, { candidate_name: "Doni" }),
        ]);

        // Nothing narrows the list on its own: the filter and search layer hands
        // the table fewer sessions than the Assessment has, and it reads this
        // branch rather than the invitation prompt.
        await userEvent.type(screen.getByRole("textbox", { name: /search candidates/i }), "zzz");

        expect(screen.getByText("No candidates match")).toBeInTheDocument();
        expect(screen.getByText(/this assessment has 2 candidates/i)).toBeInTheDocument();
        expect(screen.queryByText("No candidates yet")).not.toBeInTheDocument();
        expect(screen.queryByText(/generate an interview link/i)).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("still counts the cohort when the table is empty, which is the only line that explains it", async () => {
        await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 95, { candidate_name: "Wati" }),
            sessionFrom(CONTRACT.completed, 96, { candidate_name: "Doni" }),
        ]);

        await userEvent.type(screen.getByRole("textbox", { name: /search candidates/i }), "zzz");

        // The spec puts this line beneath the table, and an empty table is exactly
        // when an assessor most needs to be told the Assessment has candidates.
        expect(screen.getByText("Showing 0 of 2 candidates")).toBeInTheDocument();
    });

    it("puts a newly created invite in the table as a row, not in a card of its own", async () => {
        const created = sessionFrom(CONTRACT.awaiting, 87, { candidate_name: "Rina" });

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
                }),
            ),
            http.get(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { sessions: [] } }),
            ),
            http.post(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { session: created } }),
            ),
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
        expect(
            within(row as HTMLElement).getByRole("button", { name: /copy link/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/share with your candidate/i)).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /copy link/i })).toHaveLength(1);
    });

    it("keeps the header, the scroll cap and the sideways overflow inside the table's own container", async () => {
        await renderPageWith([sessionFrom(CONTRACT.awaiting, 88)]);

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
            sessionFrom(CONTRACT.awaiting, 89),
            sessionFrom(CONTRACT.live, 90, { started_at: STARTED_AT }),
            sessionFrom(CONTRACT.completed, 91, { duration_seconds: 1110 }),
            sessionFrom(CONTRACT.failed, 92),
        ]);

        // The Candidates section: heading, table and the count beneath it.
        const section = screen.getByRole("heading", { name: /candidates/i }).parentElement;
        expect(section).toBeTruthy();

        const results = await axe(section as HTMLElement);
        const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(serious).toEqual([]);
    });

    it("has no serious accessibility violations anywhere on the page", async () => {
        const { container } = await renderPageWith([
            sessionFrom(CONTRACT.awaiting, 111),
            sessionFrom(CONTRACT.live, 112, { started_at: STARTED_AT }),
            sessionFrom(CONTRACT.completed, 113, { duration_seconds: 1110 }),
            sessionFrom(CONTRACT.failed, 114),
        ]);

        // The whole rendered page, not a subtree. Every other axe case in this file
        // scopes to one region, and each of those regions was chosen to step around
        // the icon-only back link in the header — which is how they were all green
        // over a page that failed `link-name`. Scanning the container the page
        // rendered into is the only scope that can catch a defect in the header.
        const results = await axe(container);
        const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
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
    // One session per presented label, so every count in the layer is non-zero
    // and a count that moves can only have moved for one of these reasons.
    const COHORT = () => [
        sessionFrom(CONTRACT.awaiting, 100, { candidate_name: "Wati" }),
        sessionFrom(CONTRACT.awaiting, 101, { candidate_name: "Sari" }),
        sessionFrom(CONTRACT.live, 102, { candidate_name: "Rina" }),
        sessionFrom(CONTRACT.completed, 103, { candidate_name: "Doni" }),
        sessionFrom(CONTRACT.failed, 104, { candidate_name: "Agus" }),
    ];

    function cardsGroup() {
        return screen.getByRole("group", { name: "Candidate summary" });
    }
    function cards() {
        return within(cardsGroup());
    }
    function tabs() {
        return within(screen.getByRole("group", { name: "Filter by session state" }));
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

        expect(
            cards()
                .getAllByRole("button")
                .map((button) => button.textContent),
        ).toEqual(["Total candidates 5", "Awaiting candidate 2", "Live 1", "Completed 1"]);
    });

    it("counts a zero rather than dropping the card that would have shown it", async () => {
        // A cohort with nothing live and nothing completed.
        await renderWithSessions([sessionFrom(CONTRACT.awaiting, 105)]);

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

    it("narrows by name and by session state together, so neither replaces the other", async () => {
        await renderWithSessions(COHORT());

        await userEvent.click(tab("Live 1"));
        await userEvent.type(searchBox(), "doni");

        // Doni is completed, so a search that replaced the filter would show them.
        expect(screen.getByText("No candidates match")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();

        await userEvent.clear(searchBox());
        await userEvent.type(searchBox(), "rina");
        expect(bodyRows()).toHaveLength(1);

        // And the same the other way round: changing the state does not discard the
        // name the assessor has typed.
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
        const created = sessionFrom(CONTRACT.awaiting, 106, { candidate_name: "Rina" });
        // What the endpoint reports: nothing before the invite, then the new
        // session awaiting, then — at the next poll — the same session live.
        let polled: Session[] = [];

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
                }),
            ),
            http.get(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { sessions: polled } }),
            ),
            http.post(`${API_BASE}/assessments/1/sessions`, () =>
                HttpResponse.json({ data: { session: created } }),
            ),
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
        // The newest invite of a one-candidate cohort is also its highest position.
        expect(within(freshRow as HTMLElement).getAllByRole("cell")[0].textContent).toBe("1");
        expect(
            within(freshRow as HTMLElement).getByRole("button", { name: /copy link/i }),
        ).toBeInTheDocument();
        expect(isHighlighted(freshRow as HTMLElement)).toBe(true);

        polled = [
            sessionFrom(CONTRACT.live, 106, {
                candidate_name: "Rina",
                started_at: "2026-06-15T12:00:00Z",
            }),
        ];
        await act(async () => {
            pollOnce?.();
        });

        // Polling reported the candidate had joined, so the row stops claiming to
        // be new. Nothing was scheduled to expire it.
        const joinedRow = (await screen.findByRole("cell", { name: "Rina" })).closest("tr");
        expect(isHighlighted(joinedRow as HTMLElement)).toBe(false);
        expect(within(joinedRow as HTMLElement).getByText("Live")).toBeInTheDocument();
        expect(
            within(joinedRow as HTMLElement).getByRole("button", { name: /monitor/i }),
        ).toBeInTheDocument();
    });

    it("has no serious accessibility violations over the summary layer", async () => {
        await renderWithSessions(COHORT());

        // The cards' group sits in the layer alongside the tabs and the search box,
        // so the layer is what a scan should cover.
        const layer = cardsGroup().parentElement;
        expect(layer).toBeTruthy();

        const results = await axe(layer as HTMLElement);
        const serious = results.violations.filter(
            (v) => v.impact === "serious" || v.impact === "critical",
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
