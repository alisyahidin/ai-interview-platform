import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Eye, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { cn } from "@/lib/utils";
import { sessionPresentation } from "@/utils/sessionStatus";
import SessionStatusPill from "./SessionStatusPill";
import type { Session } from "@/types";

const STARTED_DATE = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
});
const STARTED_TIME = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
});

/** How long a finished interview ran, e.g. "42s", "18m 30s", "1h 05m". */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
    return `${rest}s`;
}

/**
 * One row of the table. Two of its cells are honestly blank rather than
 * invented: `duration_seconds` is only written when a Session ends, so an
 * awaiting or a live row has no real duration to show; and `started_at` is the
 * only thing that answers "when the interview began" — falling back to the
 * invite's creation time would answer a different question quietly. Row order
 * already conveys invite age, because the API orders newest first.
 */
function SessionRow({
    session,
    position,
    assessmentId,
    onCopy,
    copiedId,
    highlighted,
}: {
    session: Session;
    position: number;
    assessmentId: string;
    onCopy: (session: Session) => void;
    copiedId: number | null;
    /** The row of the invite the assessor has just created. */
    highlighted: boolean;
}) {
    const navigate = useNavigate();
    const presentation = sessionPresentation(session);
    const started = session.started_at ? new Date(session.started_at) : null;

    return (
        // A fresh invite is marked by a tint and a left accent on its first cell,
        // which is transparent on every other row so that marking one never shifts
        // the column it sits in.
        <TableRow className={highlighted ? "bg-primary/5 hover:bg-primary/10" : undefined}>
            <TableCell
                className={cn(
                    "w-12 border-l-2 px-4 py-2.5 text-muted-foreground tabular-nums",
                    highlighted ? "border-primary" : "border-transparent",
                )}
            >
                {position}
            </TableCell>
            <TableCell className="max-w-[240px] px-4 py-2.5">
                <TruncatedText
                    className="min-w-0"
                    text={session.candidate_name || `Candidate ${position}`}
                />
            </TableCell>
            <TableCell className="px-4 py-2.5">
                <SessionStatusPill session={session} />
            </TableCell>
            <TableCell className="px-4 py-2.5">
                {started ? (
                    <div className="leading-tight">
                        <div>{STARTED_DATE.format(started)}</div>
                        <div className="text-xs text-muted-foreground">
                            {STARTED_TIME.format(started)}
                        </div>
                    </div>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell className="px-4 py-2.5">
                {session.duration_seconds != null ? (
                    <span className="tabular-nums">{formatDuration(session.duration_seconds)}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                    {presentation === "awaiting_candidate" && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => onCopy(session)}
                            >
                                {copiedId === session.id ? (
                                    <>
                                        <Check className="h-3 w-3 mr-1" aria-hidden="true" /> Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-3 w-3 mr-1" aria-hidden="true" /> Copy
                                        link
                                    </>
                                )}
                            </Button>
                            {/* Swapping the button's own label confirms the copy to whoever
                  can see it and to nobody else: a name change is not an
                  announcement. The region is rendered empty and always — a live
                  region that arrives at the same moment as its text is not
                  announced. */}
                            <span role="status" className="sr-only">
                                {copiedId === session.id ? "Invite link copied" : ""}
                            </span>
                        </>
                    )}
                    {presentation === "live" && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                                navigate(
                                    `/assessments/${assessmentId}/sessions/${session.id}/monitor`,
                                )
                            }
                        >
                            <Eye className="h-3 w-3 mr-1" aria-hidden="true" /> Monitor
                        </Button>
                    )}
                    {/* A failed Session produced no interview worth opening, so it gets
              no action — the same as before this table existed. */}
                    {presentation === "completed" && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                                navigate(
                                    `/assessments/${assessmentId}/sessions/${session.id}/portfolio`,
                                )
                            }
                        >
                            Results
                        </Button>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
}

interface SessionTableProps {
    /**
     * Every Session the Assessment has, before any narrowing. It is the source
     * of both numbers the table states — how many candidates there are, and what
     * position each row holds — so the two cannot come from different lists and
     * disagree. `sessions` is always a subset of it.
     */
    cohort: Session[];
    /** The sessions to show, already narrowed by the filter and search layer. */
    sessions: Session[];
    assessmentId: string;
    onCopy: (session: Session) => void;
    copiedId: number | null;
    /** The session whose invite was just created, while the list still reports
     *  it as awaiting its candidate — `null` for every other row, and for this
     *  one too once it stops being new. */
    highlightedId: number | null;
}

export default function SessionTable({
    cohort,
    sessions,
    assessmentId,
    onCopy,
    copiedId,
    highlightedId,
}: SessionTableProps) {
    const total = cohort.length;

    // A row's position is counted from the whole cohort, newest first, because
    // the number beside a candidate has to name them in the Assessment rather
    // than in the current view of it: if it were counted from `sessions`, then
    // "candidate 1" would be one person before a filter and a different one
    // after, which is the opposite of being able to say the number out loud. The
    // newest invite takes the highest number, so an arriving invite does not
    // renumber everyone below it either.
    const positions = useMemo(() => {
        const bySessionId = new Map<number, number>();
        cohort.forEach((session, i) => bySessionId.set(session.id, cohort.length - i));
        return bySessionId;
    }, [cohort]);

    if (sessions.length === 0) {
        // The count still renders: on these two paths it is the one line that says
        // why the table is empty — "you have none" and "your filter is too
        // narrow" are different problems with the same empty screen.
        return (
            <div className="space-y-2">
                {total > 0 ? (
                    <EmptyCohort
                        title="No candidates match"
                        detail={`This Assessment has ${total} candidate${total === 1 ? "" : "s"}, but none of them match what you asked for.`}
                    />
                ) : (
                    <EmptyCohort
                        title="No candidates yet"
                        detail={'Click "Invite Candidate" to generate an interview link.'}
                    />
                )}
                <ShownOfTotal shown={0} total={total} />
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {/* Sticky header + a capped scroll container keep a long cohort scannable
          and keep horizontal overflow inside the table rather than on the page.
          The max-height lands on the Table's own overflow-auto wrapper — the
          nearest scrollport, which is what the sticky header has to stick to —
          by inheritance from this container. The header only sticks because the
          Table primitive separates its borders; see the note there. */}
            <div className="overflow-hidden rounded-lg border [&>div]:max-h-[28rem]">
                <TooltipProvider delayDuration={200}>
                    <Table aria-label="Candidate sessions" className="min-w-[720px]">
                        <TableHeader>
                            <TableRow className="sticky top-0 z-10 bg-muted hover:bg-muted">
                                <TableHead scope="col" className="w-12 px-4 py-2.5">
                                    #
                                </TableHead>
                                <TableHead scope="col" className="px-4 py-2.5">
                                    Candidate
                                </TableHead>
                                <TableHead scope="col" className="px-4 py-2.5">
                                    Status
                                </TableHead>
                                <TableHead scope="col" className="px-4 py-2.5">
                                    Started
                                </TableHead>
                                <TableHead scope="col" className="px-4 py-2.5">
                                    Duration
                                </TableHead>
                                <TableHead scope="col" className="px-4 py-2.5 text-right">
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sessions.map((session) => (
                                <SessionRow
                                    key={session.id}
                                    session={session}
                                    // `sessions` is narrowed out of `cohort`, so every row is in
                                    // it; the assertion is the invariant made visible.
                                    position={positions.get(session.id)!}
                                    assessmentId={assessmentId}
                                    onCopy={onCopy}
                                    copiedId={copiedId}
                                    highlighted={session.id === highlightedId}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </TooltipProvider>
            </div>

            <ShownOfTotal shown={sessions.length} total={total} />
        </div>
    );
}

/** The one line that says how much of the cohort is on screen. */
function ShownOfTotal({ shown, total }: { shown: number; total: number }) {
    return (
        <p className="text-xs text-muted-foreground">
            Showing {shown} of {total} candidate{total === 1 ? "" : "s"}
        </p>
    );
}

/**
 * The shell both empty answers share. "No candidates yet" and "No candidates
 * match" are the same screen saying two different things, so they differ in
 * the two strings passed in and share every mark up rather than being the same
 * markup written out twice.
 */
function EmptyCohort({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="border rounded-lg p-10 text-center space-y-3">
            <UserRound className="h-8 w-8 text-muted-foreground mx-auto" />
            <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">{detail}</p>
            </div>
        </div>
    );
}
