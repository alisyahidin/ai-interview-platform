import { cn } from "@/lib/utils";
import {
  sessionPresentation,
  type SessionPresentation,
  type StatusBearingSession,
} from "@/utils/sessionStatus";

/**
 * Light-mode Tailwind palette pairs, deliberately NOT the judgment colour
 * tokens: those encode a skill's assessment judgment, and reusing them for a
 * Session's lifecycle state would be a category error. The text label is the
 * non-colour signal, so colour is never the only one; only Live adds a pulse,
 * so liveness never depends on hue either.
 */
const PRESENTATION: Record<
  SessionPresentation,
  { label: string; className: string; pulse?: boolean }
> = {
  awaiting_candidate: {
    label: "Awaiting candidate",
    className: "bg-amber-100 text-amber-800",
  },
  live: {
    label: "Live",
    className: "bg-blue-100 text-blue-800",
    pulse: true,
  },
  completed: {
    label: "Completed",
    className: "bg-teal-100 text-teal-800",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800",
  },
};

export default function SessionStatusPill({
  session,
  className,
}: {
  session: StatusBearingSession;
  className?: string;
}) {
  const { label, className: tone, pulse } = PRESENTATION[
    sessionPresentation(session)
  ];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
        tone,
        className
      )}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
        />
      )}
      {label}
    </span>
  );
}
