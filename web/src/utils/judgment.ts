import type { AssessmentStatus, ConfidenceLevel } from "@/types";

export interface JudgmentClassification {
  /** No usable level exists — the base "N/A" treatment always wins. */
  isNotAssessed: boolean;
  /** A real level exists but confidence is low — outlined, not firm. */
  isTentative: boolean;
  /** Orthogonal to the two above: can sit on top of either base state. */
  isNeedsReview: boolean;
}

/**
 * Single source of truth for the assessed/tentative/not-assessed/needs-review
 * classification used across the portfolio and fit/gap screens (previously
 * reimplemented independently in `LevelBadge`, `ComparisonTable`, and twice
 * in `SkillPortfolioCard`).
 *
 * `not_assessed` always wins outright, regardless of confidence. `tentative`
 * only applies on top of a level that actually exists. `needs_review` is
 * independent of both — it's its own `assessment_status` value, but (per
 * `api/app/services/fit_gap/engine.rb#assessed?`) always carries a real
 * level, so it never forces `isNotAssessed`.
 *
 * `opts.result` lets a fit/gap comparison row's own `result` field
 * (`"not_assessed"`) count toward `isNotAssessed` too — belt-and-braces for
 * a row where `result` and `assessment_status` might disagree.
 * `opts.hasLevel` lets `LevelBadge` additionally treat a missing/unparsable
 * level as not-assessed even when `assessmentStatus` alone wouldn't say so.
 */
export function classifyJudgment(
  assessmentStatus: AssessmentStatus | undefined,
  confidence: ConfidenceLevel | null | undefined,
  opts: { result?: string | null; hasLevel?: boolean } = {}
): JudgmentClassification {
  const { result = null, hasLevel = true } = opts;

  const isNotAssessed = assessmentStatus === "not_assessed" || result === "not_assessed" || !hasLevel;
  const isTentative = !isNotAssessed && confidence === "low";
  const isNeedsReview = assessmentStatus === "needs_review";

  return { isNotAssessed, isTentative, isNeedsReview };
}
