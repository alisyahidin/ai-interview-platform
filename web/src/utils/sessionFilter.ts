import type { Session } from "@/types";
import {
    sessionPresentation,
    type SessionPresentation,
    type StateBearingSession,
} from "@/utils/sessionStatus";

/**
 * What the candidate list can be narrowed to: the four presented statuses, plus
 * the absence of a narrowing. Keyed off the presentation rather than off raw
 * status, so a `failed` filter reaches the ended sessions carrying the error
 * end reason without anything here knowing what an end reason is.
 */
export type SessionFilter = "all" | SessionPresentation;

/** The filters in the order the summary layer offers them. */
export const SESSION_FILTERS: readonly SessionFilter[] = [
    "all",
    "awaiting_candidate",
    "live",
    "completed",
    "failed",
];

/**
 * How many sessions sit behind each filter.
 *
 * Counting the whole cohort rather than the narrowed list is the point: the
 * counts answer "how much of this is there", so narrowing through one control
 * never silently moves another's number, and a tab can show what selecting it
 * would leave out.
 */
export function countByPresentation(
    sessions: readonly StateBearingSession[],
): Record<SessionFilter, number> {
    const counts: Record<SessionFilter, number> = {
        all: sessions.length,
        awaiting_candidate: 0,
        live: 0,
        completed: 0,
        failed: 0,
    };
    for (const session of sessions) {
        counts[sessionPresentation(session)] += 1;
    }
    return counts;
}

/**
 * The sessions the table should show: those behind `filter`, further narrowed
 * to the ones whose candidate name contains `query`. The two narrowings
 * compose, because "live and named Ali" is one question and either half of it
 * is not a substitute for the other.
 *
 * Name only. A Session carries a name but no email, so matching on anything
 * else would be matching on a field that does not exist.
 */
export function filterSessions(
    sessions: readonly Session[],
    filter: SessionFilter,
    query: string,
): Session[] {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
        if (filter !== "all" && sessionPresentation(session) !== filter) {
            return false;
        }
        if (!needle) return true;
        return (session.candidate_name ?? "").toLowerCase().includes(needle);
    });
}
