import type { Session } from "@/types";

/**
 * The four labels a Session is presented with. Three of them name a Session
 * state; the fourth is derived (see `sessionPresentation`).
 */
export type SessionPresentation =
  | "awaiting_candidate"
  | "live"
  | "completed"
  | "failed";

/** The only fields a presented status may be derived from. */
export type StatusBearingSession = Pick<Session, "status" | "end_reason">;

/**
 * The product's vocabulary for each presented status, in one place because
 * three surfaces say it out loud: the pill on a row, the count card that
 * summarises the cohort, and the filter tab that narrows to it. These words
 * are the product's, so they are not spelled out again per surface.
 */
export const SESSION_PRESENTATION_LABELS: Record<SessionPresentation, string> = {
  awaiting_candidate: "Awaiting candidate",
  live: "Live",
  completed: "Completed",
  failed: "Failed",
};

/**
 * Single source of truth for the label a Session is presented with, derived
 * from the two fields the sessions-index response actually returns.
 *
 * "Failed" is a presentation, not a fourth state: the backend's status
 * enumeration contains a `failed` value that nothing ever writes — errors are
 * recorded as an ended Session carrying the error end reason — so the
 * frontend must not model, read, or display a fourth status. Deriving the
 * label instead is the point (ADR-0002).
 */
export function sessionPresentation(
  session: StatusBearingSession
): SessionPresentation {
  switch (session.status) {
    case "pending":
      return "awaiting_candidate";
    case "active":
      return "live";
    case "ended":
      return session.end_reason === "error" ? "failed" : "completed";
  }
}
