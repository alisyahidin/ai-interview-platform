import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SESSION_PRESENTATION_LABELS } from "@/utils/sessionStatus";
import { SESSION_FILTERS, type SessionFilter } from "@/utils/sessionFilter";

/**
 * Tab captions are the short form of a Session state, not its label: a pill
 * names the state a Session is in ("Awaiting candidate"), a tab names the
 * narrowing ("Awaiting") so five of them fit on one row beside a search box.
 * The three captions the two forms share are read from the shared labels rather
 * than retyped, so a word only ever exists in one place.
 */
const TAB_LABELS: Record<SessionFilter, string> = {
    all: "All",
    awaiting_candidate: "Awaiting",
    live: SESSION_PRESENTATION_LABELS.live,
    completed: SESSION_PRESENTATION_LABELS.completed,
    failed: SESSION_PRESENTATION_LABELS.failed,
};

/**
 * The four states the cohort is summarised by. Failed is deliberately not one
 * of them: a failed session is a small minority of any cohort, and a fifth card
 * beside Completed would be near-duplicate chrome — so Failed stays reachable
 * through its tab and goes uncounted on purpose.
 */
const CARDS: Exclude<SessionFilter, "failed">[] = [
    "all",
    "awaiting_candidate",
    "live",
    "completed",
];

const CARD_LABELS: Record<(typeof CARDS)[number], string> = {
    all: "Total candidates",
    awaiting_candidate: SESSION_PRESENTATION_LABELS.awaiting_candidate,
    live: SESSION_PRESENTATION_LABELS.live,
    completed: SESSION_PRESENTATION_LABELS.completed,
};

/**
 * The summary layer above the candidate table: four count cards and five
 * filter tabs, plus a name search.
 *
 * The cards and the tabs are two controls on one selection, so they cannot
 * disagree about what the table is showing — the page owns the selection and
 * both read it, rather than each keeping a count of its own. They are buttons
 * carrying `aria-pressed` rather than a tab list, because narrowing a table is
 * not navigating between panels.
 */
export default function SessionSummary({
    counts,
    filter,
    onFilterChange,
    query,
    onQueryChange,
}: {
    counts: Record<SessionFilter, number>;
    filter: SessionFilter;
    onFilterChange: (filter: SessionFilter) => void;
    query: string;
    onQueryChange: (query: string) => void;
}) {
    const searchRef = useRef<HTMLInputElement>(null);

    // `/` is a shortcut only when the assessor is not already typing: in a field
    // a slash is a slash, and eating it would be the shortcut stealing input.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable]")) return;
            event.preventDefault();
            searchRef.current?.focus();
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <div className="space-y-3">
            <div
                role="group"
                aria-label="Candidate summary"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
                {CARDS.map((key) => {
                    const active = filter === key;
                    return (
                        <Card
                            key={key}
                            className={cn("p-0", active && "border-primary ring-1 ring-primary")}
                        >
                            <button
                                type="button"
                                aria-pressed={active}
                                onClick={() => onFilterChange(key)}
                                className="flex w-full flex-col gap-1 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                <span className="text-xs text-muted-foreground">
                                    {CARD_LABELS[key]}
                                </span>{" "}
                                <span className="text-2xl font-semibold tabular-nums">
                                    {counts[key]}
                                </span>
                            </button>
                        </Card>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                    role="group"
                    aria-label="Filter by session state"
                    className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
                >
                    {SESSION_FILTERS.map((key) => {
                        const active = filter === key;
                        return (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onFilterChange(key)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                    active
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {TAB_LABELS[key]}{" "}
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    {counts[key]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-2">
                    <Label htmlFor="session-candidate-search" className="sr-only">
                        Search candidates
                    </Label>
                    <div className="relative">
                        <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            id="session-candidate-search"
                            ref={searchRef}
                            value={query}
                            onChange={(event) => onQueryChange(event.target.value)}
                            placeholder="Search candidates"
                            className="h-9 w-64 pl-8"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
