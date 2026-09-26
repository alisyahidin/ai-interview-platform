import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import sessionsIndex from "@/mocks/fixtures/generated/sessions_index.json";
import SessionTable from "./SessionTable";
import type { Session } from "@/types";

// The position map is the one place the table makes a claim it cannot verify
// from its own props: a rank is a position within the `cohort` array, so its
// correctness depends on that array arriving whole and in render order. The
// table no longer asserts its way past a miss, so the behaviour of a miss is
// pinned here — directly against the component, because the page cannot produce
// one: it narrows `cohort` rather than replacing it.
//
// Payloads are the generated sessions-index ones, as everywhere else in this
// suite, so no case below can assert against a field the API never sends
// (ADR-0002). The id is the one field a case picks outright.

const CONTRACT_SESSIONS = sessionsIndex.data.sessions as Session[];

function contractSession(match: (session: Session) => boolean): Session {
    const found = CONTRACT_SESSIONS.find(match);
    if (!found) {
        throw new Error("no generated sessions-index session matches");
    }
    return found;
}

const NAMED = contractSession((s) => s.status === "pending" && !!s.candidate_name);
const UNNAMED = contractSession((s) => s.status === "pending" && !s.candidate_name);

function sessionFrom(template: Session, id: number, overrides: Partial<Session> = {}): Session {
    return { ...template, id, ...overrides };
}

function renderTable({ cohort, sessions }: { cohort: Session[]; sessions: Session[] }) {
    return render(
        <MemoryRouter>
            <SessionTable
                cohort={cohort}
                sessions={sessions}
                assessmentId="1"
                onCopy={() => {}}
                copiedId={null}
                highlightedId={null}
            />
        </MemoryRouter>,
    );
}

function bodyRows() {
    return within(screen.getByRole("table", { name: "Candidate sessions" }))
        .getAllByRole("row")
        .slice(1);
}

function indexCells() {
    return bodyRows().map((row) => within(row).getAllByRole("cell")[0]);
}

describe("SessionTable row positions", () => {
    it("numbers each row by its rank in the cohort, newest first", () => {
        // The well-formed case, so the miss cases below cannot be read as the
        // normal path: a cohort that arrives whole and in order still numbers.
        const cohort = [
            sessionFrom(NAMED, 1, { candidate_name: "Newest" }),
            sessionFrom(NAMED, 2, { candidate_name: "Middle" }),
            sessionFrom(NAMED, 3, { candidate_name: "Oldest" }),
        ];
        renderTable({ cohort, sessions: cohort });

        expect(indexCells().map((cell) => cell.textContent)).toEqual(["3", "2", "1"]);
    });

    it("dashes the index cell of a row the cohort does not account for, rather than leaving it blank", () => {
        // The caller-error shape: a row drawn from a list the cohort does not
        // hold. A dash is the same honest blank the Started and Duration cells
        // use; an empty cell would read as a row with position zero.
        const orphan = sessionFrom(NAMED, 9, { candidate_name: "Orphan" });
        renderTable({
            cohort: [sessionFrom(NAMED, 8, { candidate_name: "Held" })],
            sessions: [orphan],
        });

        const [index] = indexCells();
        expect(index.textContent).toBe("—");
        expect(index.textContent?.trim()).not.toBe("");
    });

    it("bare-names an unnamed row the cohort does not account for, never `Candidate undefined`", () => {
        // The API sends a null name, so the rank is what the fallback label is
        // built from — and there is none. Both cells that could interpolate the
        // missing rank are asserted: the index cell dashes, and the label stops
        // at "Candidate" instead of reading out the miss. This is the case the
        // non-null assertion used to render as a blank cell reading
        // "Candidate undefined".
        const orphan = sessionFrom(UNNAMED, 9);
        renderTable({
            cohort: [sessionFrom(NAMED, 8, { candidate_name: "Held" })],
            sessions: [orphan],
        });

        expect(screen.getByRole("cell", { name: "Candidate" })).toBeInTheDocument();
        expect(indexCells()[0].textContent).toBe("—");
        expect(bodyRows()[0].textContent).not.toContain("undefined");
    });

    it("still numbers the rows it does account for when a neighbour misses", () => {
        // A miss is a property of one row, not a reason to stop counting: the
        // rows the cohort holds keep the ranks it gives them.
        const held = sessionFrom(NAMED, 8, { candidate_name: "Held" });
        const orphan = sessionFrom(NAMED, 9, { candidate_name: "Orphan" });
        renderTable({ cohort: [held], sessions: [orphan, held] });

        expect(indexCells().map((cell) => cell.textContent)).toEqual(["—", "1"]);
    });
});
