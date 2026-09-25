import WrongStateState from "@/components/resource/WrongStateState";
import type { Session } from "@/types";

export interface SessionWrongStateProps {
  session: Session;
  /** Noun for what's missing, e.g. "portfolio" or "transcript". */
  contentLabel: string;
  backTo: string;
  backLabel?: string;
}

/**
 * Copy + layout for the guarded "wrong-state" explanation (AC16) shown when
 * `sessionHasNoContentYet` rejects a session — shared between PortfolioPage
 * and TranscriptPage (ticket #18), which only differ by `contentLabel`.
 */
export default function SessionWrongState({
  session,
  contentLabel,
  backTo,
  backLabel = "Back to sessions",
}: SessionWrongStateProps) {
  const { title, description } =
    session.status === "pending"
      ? {
          title: "Interview hasn't started yet",
          description: `This candidate hasn't started their interview, so there's no ${contentLabel} to show yet. Check back once they've completed it.`,
        }
      : {
          title: "Interview didn't complete",
          description: `This session ended before an interview was completed, so no ${contentLabel} was generated.`,
        };

  return (
    <div className="max-w-2xl mx-auto">
      <WrongStateState title={title} description={description} backTo={backTo} backLabel={backLabel} />
    </div>
  );
}
