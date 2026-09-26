import { cn } from "@/lib/utils";
import {
    sessionPresentation,
    SESSION_PRESENTATION_LABELS,
    type SessionPresentation,
    type StateBearingSession,
} from "@/utils/sessionState";

/**
 * Light-mode Tailwind palette pairs, deliberately NOT the judgment colour
 * tokens: those encode a skill's assessment judgment, and reusing them for a
 * Session's lifecycle state would be a category error. The text label is the
 * non-colour signal, so colour is never the only one; only Live adds a pulse,
 * so liveness never depends on hue either.
 */
const PRESENTATION: Record<SessionPresentation, { className: string; pulse?: boolean }> = {
    awaiting_candidate: {
        className: "bg-amber-100 text-amber-800",
    },
    live: {
        className: "bg-blue-100 text-blue-800",
        pulse: true,
    },
    completed: {
        className: "bg-teal-100 text-teal-800",
    },
    failed: {
        className: "bg-red-100 text-red-800",
    },
};

export default function SessionStatePill({
    session,
    className,
}: {
    session: StateBearingSession;
    className?: string;
}) {
    const presentation = sessionPresentation(session);
    const { className: tone, pulse } = PRESENTATION[presentation];

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
                tone,
                className,
            )}
        >
            {pulse && (
                <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
                />
            )}
            {SESSION_PRESENTATION_LABELS[presentation]}
        </span>
    );
}
