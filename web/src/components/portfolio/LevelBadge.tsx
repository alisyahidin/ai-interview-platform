import { CheckCircle2, CircleDashed, HelpCircle } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { LEVEL_LABELS, LEVEL_DESCRIPTIONS } from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { AssessmentStatus, ConfidenceLevel } from "@/types";

interface LevelBadgeProps {
  /** The level to render (AI's or an assessor's override). `null`/`undefined` renders the not-assessed treatment. */
  level: number | null | undefined;
  /**
   * Drives the badge's base visual treatment (F43/AC1-3): `not_assessed`
   * always wins regardless of `level`; `needs_review` is intentionally NOT
   * a distinct badge shape here — it always carries a real level, so it
   * renders identically to `assessed` and is flagged separately by
   * `NeedsReviewFlag` layered alongside this badge.
   */
  assessmentStatus?: AssessmentStatus;
  /** Only distinguishes `assessed` (solid) from the `tentative` outline treatment when low. */
  confidence?: ConfidenceLevel;
  size?: "sm" | "md";
  className?: string;
}

export default function LevelBadge({
  level,
  assessmentStatus = "assessed",
  confidence,
  size = "md",
  className,
}: LevelBadgeProps) {
  const isNotAssessed = assessmentStatus === "not_assessed" || level == null;
  const isTentative = !isNotAssessed && confidence === "low";

  const variant: BadgeProps["variant"] = isNotAssessed
    ? "notAssessed"
    : isTentative
      ? "tentative"
      : "assessed";

  const Icon = isNotAssessed ? CircleDashed : isTentative ? HelpCircle : CheckCircle2;

  const primaryText = isNotAssessed ? "N/A" : LEVEL_LABELS[level as number] ?? `L${level}`;
  const secondaryText = isNotAssessed
    ? "Not assessed"
    : isTentative
      ? "Limited evidence"
      : LEVEL_DESCRIPTIONS[level as number] ?? "";

  return (
    <Badge
      variant={variant}
      className={cn(
        "flex-col items-center justify-center gap-0 rounded font-semibold",
        size === "md" ? "px-3 py-2 min-w-14 text-base" : "px-2 py-1 min-w-10 text-sm",
        className
      )}
    >
      <span className="flex items-center gap-1 leading-none">
        <Icon aria-hidden="true" className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
        {primaryText}
      </span>
      {size === "md" && secondaryText && (
        <span className="text-[10px] font-normal opacity-80 leading-tight">{secondaryText}</span>
      )}
    </Badge>
  );
}
