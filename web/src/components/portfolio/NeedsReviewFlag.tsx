import { Flag } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NeedsReviewFlagProps {
  /**
   * Optional: when provided, the flag becomes a real button (not just a
   * coloured label) whose explicit call-to-action opens and focuses
   * whatever review UI the caller wires up — on the portfolio card, the
   * existing `OverridePanel` via its ref. Screens with no such action
   * available (e.g. the read-only fit/gap comparison table) omit it and
   * get a plain, non-interactive flag chip instead — same visual, same
   * orthogonal meaning, just nothing to activate.
   */
  onActivate?: () => void;
}

/**
 * Orthogonal `needs_review` flag (AC4): renders alongside — never instead
 * of — the assessed/tentative `LevelBadge`/base result. Reused verbatim on
 * both the portfolio card and the fit/gap comparison table.
 */
export default function NeedsReviewFlag({ onActivate }: NeedsReviewFlagProps) {
  const badgeClassName = cn(badgeVariants({ variant: "needsReview" }), "gap-1");

  if (!onActivate) {
    return (
      <span className={badgeClassName} aria-label="Needs review. This skill's AI rating needs a human check.">
        <Flag aria-hidden="true" className="h-3 w-3" />
        Needs review
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        badgeClassName,
        "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
      aria-label="Needs review. This skill's AI rating needs a human check — activate to open the override panel."
    >
      <Flag aria-hidden="true" className="h-3 w-3" />
      Needs review
    </button>
  );
}
