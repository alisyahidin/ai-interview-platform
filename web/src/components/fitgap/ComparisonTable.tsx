import { useId, useState } from "react";
import { LEVEL_LABELS, FIT_GAP_RESULT_LABELS, FIT_GAP_RESULT_CLASSES } from "@/utils/constants";
import { classifyJudgment } from "@/utils/judgment";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import NeedsReviewFlag from "@/components/portfolio/NeedsReviewFlag";
import type { SkillComparison } from "@/types";

interface ComparisonTableProps {
  comparisons: SkillComparison[];
}

// A row is "not assessed" if the comparison itself says so, or (belt and
// braces) if the underlying skill's assessment_status says so even when
// `result` hasn't caught up — see the AssessmentStatus comment in types.
function isNotAssessed(c: SkillComparison): boolean {
  return classifyJudgment(c.assessment_status, c.confidence, { result: c.result }).isNotAssessed;
}

// Low-confidence rows must never read as a firm result (AC11): they're
// marked tentative and kept out of the firm match/gap/exceed tallies.
function isTentative(c: SkillComparison): boolean {
  return classifyJudgment(c.assessment_status, c.confidence, { result: c.result }).isTentative;
}

// Orthogonal `needs_review` flag (spec #21): can sit on top of any of the
// three result states above — a needs_review row still carries a real
// candidate_level/delta/result (see FitGap::Engine#assessed?), so this is
// checked independently rather than folded into isNotAssessed/isTentative.
function isNeedsReview(c: SkillComparison): boolean {
  return classifyJudgment(c.assessment_status, c.confidence, { result: c.result }).isNeedsReview;
}

function OverrideMarker({ originalLevel }: { originalLevel?: number | null }) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-block ml-1">
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        aria-label="Overridden by assessor. Show AI's original level."
        // A real click also fires a preceding native focus event (which
        // already opens the tooltip via onFocus below) — toggling here too
        // would immediately close what focus just opened. Click simply
        // ensures it's open; Escape/blur are the close paths.
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-[10px] leading-none text-amber-700 hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <span aria-hidden="true">✏</span>
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        >
          AI&apos;s original level:{" "}
          {originalLevel != null ? LEVEL_LABELS[originalLevel] ?? originalLevel : "unknown"}
        </span>
      )}
    </span>
  );
}

function ResultBadge({ comparison }: { comparison: SkillComparison }) {
  const notAssessed = isNotAssessed(comparison);
  const tentative = isTentative(comparison);
  const label = notAssessed ? "Not assessed" : FIT_GAP_RESULT_LABELS[comparison.result];

  let icon = "—";
  let suffix = "";
  if (!notAssessed) {
    if (comparison.result === "exceed") suffix = comparison.delta ? ` +${comparison.delta}` : "";
    else if (comparison.result === "gap") suffix = comparison.delta ? ` -${Math.abs(comparison.delta)}` : "";

    if (tentative) icon = "❔";
    else if (comparison.result === "match") icon = "✅";
    else if (comparison.result === "exceed") icon = "⭐";
    else if (comparison.result === "gap") icon = "⚠";
  }

  const classes = notAssessed
    ? FIT_GAP_RESULT_CLASSES.not_assessed
    : tentative
      ? "text-amber-700 bg-transparent border border-dashed border-amber-400"
      : FIT_GAP_RESULT_CLASSES[comparison.result];

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded", classes)}>
      <span aria-hidden="true">{icon}</span>
      <span>
        {label}
        {suffix}
        {tentative ? " (tentative)" : ""}
      </span>
      {tentative && (
        <span className="sr-only">
          {" "}
          — limited evidence; treat as tentative, not a confirmed {FIT_GAP_RESULT_LABELS[comparison.result]?.toLowerCase()}
        </span>
      )}
    </span>
  );
}

export default function ComparisonTable({ comparisons }: ComparisonTableProps) {
  // Firm tallies exclude both not-assessed and tentative (low-confidence)
  // rows, so a shaky single probe never inflates the gap count (AC9/AC11).
  const matchCount = comparisons.filter((c) => !isNotAssessed(c) && !isTentative(c) && c.result === "match").length;
  const gapCount = comparisons.filter((c) => !isNotAssessed(c) && !isTentative(c) && c.result === "gap").length;
  const exceedCount = comparisons.filter((c) => !isNotAssessed(c) && !isTentative(c) && c.result === "exceed").length;
  const tentativeCount = comparisons.filter((c) => !isNotAssessed(c) && isTentative(c)).length;
  const notAssessedSkills = comparisons.filter(isNotAssessed);
  const needsReviewCount = comparisons.filter(isNeedsReview).length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        {/* Sticky header + internal scroll keeps a 40-row table scannable
            (AC13) and keeps horizontal overflow inside this container
            instead of the page (AC34). */}
        <div className="max-h-[28rem] overflow-y-auto overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b bg-muted text-left">
                <th className="px-4 py-2.5 font-medium">Skill</th>
                <th className="px-4 py-2.5 font-medium text-center">Required</th>
                <th className="px-4 py-2.5 font-medium text-center">Candidate</th>
                <th className="px-4 py-2.5 font-medium text-center">Result</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c, i) => {
                const notAssessed = isNotAssessed(c);
                return (
                  <tr key={c.skill_id ?? `${c.skill_label}-${i}`} className="border-b last:border-0">
                    <td className="px-4 py-2.5 max-w-[240px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TruncatedText text={c.skill_label} className="min-w-0" />
                        {isNeedsReview(c) && <NeedsReviewFlag />}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {LEVEL_LABELS[c.expected_level] ?? c.expected_level}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!notAssessed && c.candidate_level != null ? (
                        <span className="inline-flex items-center">
                          {LEVEL_LABELS[c.candidate_level] ?? c.candidate_level}
                          {c.is_override && <OverrideMarker originalLevel={c.original_level} />}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{notAssessed ? "Not assessed" : "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <ResultBadge comparison={c} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {matchCount > 0 && (
            <span>
              ✅ Match: {matchCount} skill{matchCount !== 1 ? "s" : ""}
            </span>
          )}
          {gapCount > 0 && (
            <span>
              ⚠ Gap: {gapCount} skill{gapCount !== 1 ? "s" : ""}
            </span>
          )}
          {exceedCount > 0 && (
            <span>
              ⭐ Exceeds: {exceedCount} skill{exceedCount !== 1 ? "s" : ""}
            </span>
          )}
          {tentativeCount > 0 && (
            <span>
              ❔ Tentative: {tentativeCount} skill{tentativeCount !== 1 ? "s" : ""} (low confidence, not a firm result)
            </span>
          )}
          {notAssessedSkills.length > 0 && (
            <span>
              — Not assessed: {notAssessedSkills.length} skill{notAssessedSkills.length !== 1 ? "s" : ""} (
              {notAssessedSkills.map((c) => c.skill_label).join(", ")})
            </span>
          )}
          {needsReviewCount > 0 && (
            <span>
              🚩 Needs review: {needsReviewCount} skill{needsReviewCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="ml-auto">✏ = human override applied</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
