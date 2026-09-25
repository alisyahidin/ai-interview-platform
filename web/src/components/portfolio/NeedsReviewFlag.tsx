import { Flag } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NeedsReviewFlagProps {
  onActivate: () => void;
}

/**
 * Orthogonal `needs_review` flag (AC4): renders alongside — never instead
 * of — the assessed/tentative `LevelBadge`. It's a real button (not just a
 * coloured label) whose explicit call-to-action opens and focuses the
 * existing `OverridePanel` via the ref `SkillPortfolioCard` wires up.
 */
export default function NeedsReviewFlag({ onActivate }: NeedsReviewFlagProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        badgeVariants({ variant: "needsReview" }),
        "gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
      aria-label="Needs review. This skill's AI rating needs a human check — activate to open the override panel."
    >
      <Flag aria-hidden="true" className="h-3 w-3" />
      Needs review
    </button>
  );
}
