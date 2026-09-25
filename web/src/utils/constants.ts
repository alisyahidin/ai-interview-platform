import type { ConfidenceLevel, StatusReason } from "@/types";

export const TIME_LIMIT_OPTIONS = [10, 30, 45, 60, 90] as const;

/** Parse "L3" → 3, passthrough number, null/undefined → null, unparsable → null */
export function parseLevel(level: string | number | null | undefined): number | null {
  if (level == null) return null;
  if (typeof level === "number") return level;
  const n = parseInt(level.replace(/\D/g, ""), 10);
  return isNaN(n) ? null : n;
}

export const LEVEL_LABELS: Record<number, string> = {
  1: "L1",
  2: "L2",
  3: "L3",
  4: "L4",
  5: "L5",
};

export const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: "Foundational",
  2: "Functional",
  3: "Proficient",
  4: "Advanced",
  5: "Expert",
};

// F43/D2: judgment badge colours now live as `badgeVariants` entries in
// `@/components/ui/badge` (variants: assessed/tentative/notAssessed/
// needsReview) instead of a hand-rolled per-page class lookup like this one
// used to be. Kept out of this file on purpose — see LevelBadge.tsx.

// Phase 3b (#23): confidence label copy shown next to an assessed skill's
// badge. `low` intentionally reads as "limited evidence" — that's the
// tentative-treatment language, not a raw confidence readout.
export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Limited evidence",
};

// Plain-language reasons for a `not_assessed` skill (AC2). Anything not in
// this map (including `nil`/undefined) falls back to a generic explanation
// so the UI never shows a raw enum value or blank space.
export const STATUS_REASON_LABELS: Record<Exclude<StatusReason, null>, string> = {
  omitted_by_model: "The AI didn't produce a rating for this skill during the interview.",
  invalid_model_output: "The AI's rating for this skill couldn't be understood and was discarded.",
};

export const STATUS_REASON_FALLBACK = "This skill wasn't measured during the interview.";

// Coverage state display
export const COVERAGE_STATE_LABELS: Record<string, string> = {
  not_yet: "not yet",
  initiated: "initiated",
  partial: "partial",
  covered: "covered",
};

export const COVERAGE_STATE_WIDTH: Record<string, number> = {
  not_yet: 0,
  initiated: 25,
  partial: 60,
  covered: 100,
};

export const COVERAGE_STATE_COLOR: Record<string, string> = {
  not_yet: "bg-neutral-200",
  initiated: "bg-blue-300",
  partial: "bg-teal-400",
  covered: "bg-teal-600",
};

// Fit/Gap result display
export const FIT_GAP_RESULT_LABELS: Record<string, string> = {
  match: "Match",
  gap: "Gap",
  exceed: "Exceeds",
  not_assessed: "Not assessed",
};

export const FIT_GAP_RESULT_CLASSES: Record<string, string> = {
  match: "text-green-700 bg-green-50",
  gap: "text-amber-700 bg-amber-50",
  exceed: "text-green-700 bg-green-50",
  not_assessed: "text-neutral-500 bg-neutral-50",
};
