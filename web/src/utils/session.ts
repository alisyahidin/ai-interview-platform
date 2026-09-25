import type { Session } from "@/types";

/**
 * True when a session has nothing generated or recorded yet: the candidate
 * hasn't started their interview (`pending`), or the interview ended in
 * error before producing a transcript/portfolio (`ended` with
 * `end_reason: "error"`).
 *
 * Portfolio/Transcript pages use this as the `isValidState` guard for
 * `<Resource>` so a session in either state resolves to `wrong-state`
 * instead of falling through to a blank shell or a generic empty message
 * (ticket #18 / F22).
 */
export function sessionHasNoContentYet(session: Session): boolean {
  return session.status === "pending" || (session.status === "ended" && session.end_reason === "error");
}
