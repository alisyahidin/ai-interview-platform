import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "./table";

// Ticket #46: the shared table family, hand-vendored to match the other
// primitives in this directory. This prefactor delivers no user-visible
// behaviour of its own, so what is worth pinning down is that the primitives
// render real table semantics — a table with column headers, a body of rows of
// cells — and that a caller's className wins over the primitive's own, which is
// the `cn` merge every other primitive here relies on.

function renderSmallTable() {
    return render(
        <Table aria-label="Candidate sessions">
            <TableCaption>Sessions for this assessment</TableCaption>
            <TableHeader>
                <TableRow>
                    <TableHead scope="col">#</TableHead>
                    <TableHead scope="col">Candidate</TableHead>
                    <TableHead scope="col">Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow>
                    <TableCell>1</TableCell>
                    <TableCell>Ali</TableCell>
                    <TableCell>Live</TableCell>
                </TableRow>
                <TableRow>
                    <TableCell>2</TableCell>
                    <TableCell>Budi</TableCell>
                    <TableCell>Completed</TableCell>
                </TableRow>
            </TableBody>
            <TableFooter>
                <TableRow>
                    <TableCell colSpan={3}>Showing 2 of 2 candidates</TableCell>
                </TableRow>
            </TableFooter>
        </Table>,
    );
}

describe("Table primitives", () => {
    it("exposes one table with a caption, a header, a body and a footer, each a table section", () => {
        renderSmallTable();

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        expect(
            screen.getByText("Sessions for this assessment", { selector: "caption" }),
        ).toBeInTheDocument();

        const sections = within(table)
            .getAllByRole("rowgroup")
            .map((section) => section.tagName);
        expect(sections).toEqual(["THEAD", "TBODY", "TFOOT"]);
    });

    it("renders the header cells as column headers in order, with one body row per data row", () => {
        renderSmallTable();

        const table = screen.getByRole("table", { name: "Candidate sessions" });
        const columnHeaders = within(table).getAllByRole("columnheader");
        expect(columnHeaders.map((header) => header.textContent)).toEqual([
            "#",
            "Candidate",
            "Status",
        ]);

        const rows = within(table).getAllByRole("row");
        // One header row, one row per session, one footer row.
        expect(rows).toHaveLength(4);

        const [head, ...bodyAndFooter] = rows;
        expect(within(head).queryAllByRole("cell")).toHaveLength(0);
        expect(
            within(bodyAndFooter[0])
                .getAllByRole("cell")
                .map((cell) => cell.textContent),
        ).toEqual(["1", "Ali", "Live"]);
        expect(
            within(bodyAndFooter[1])
                .getAllByRole("cell")
                .map((cell) => cell.textContent),
        ).toEqual(["2", "Budi", "Completed"]);
    });

    it("lets a caller's className override a primitive's own, instead of appending to it", () => {
        render(
            <Table>
                <TableBody>
                    <TableRow>
                        <TableHead className="h-8">Candidate</TableHead>
                        <TableCell className="p-0">Ali</TableCell>
                    </TableRow>
                </TableBody>
            </Table>,
        );

        // `cn` merges through tailwind-merge, so a later class in the same
        // Tailwind group replaces the primitive's default instead of fighting it.
        expect(screen.getByRole("columnheader", { name: "Candidate" })).toHaveClass("h-8");
        expect(screen.getByRole("columnheader", { name: "Candidate" }).className).not.toContain(
            "h-12",
        );
        expect(screen.getByRole("cell", { name: "Ali" })).toHaveClass("p-0");
        expect(screen.getByRole("cell", { name: "Ali" }).className).not.toContain("p-4");
    });
});
