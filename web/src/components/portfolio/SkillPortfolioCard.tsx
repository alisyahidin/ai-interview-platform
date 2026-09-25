import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import LevelBadge from "./LevelBadge";
import NeedsReviewFlag from "./NeedsReviewFlag";
import OverridePanel, { type OverridePanelHandle } from "./OverridePanel";
import { Zap, MessageSquareQuote } from "lucide-react";
import {
  parseLevel,
  CONFIDENCE_LABELS,
  LEVEL_DESCRIPTIONS,
  STATUS_REASON_LABELS,
  STATUS_REASON_FALLBACK,
} from "@/utils/constants";
import { cn } from "@/lib/utils";
import type { PortfolioSkill, AssessorOverride, StatusReason } from "@/types";

interface SkillPortfolioCardProps {
  skill: PortfolioSkill;
  override?: AssessorOverride;
  onOverrideSaved: (override: AssessorOverride) => void;
}

// A single evidence quote (AC38): clamps a long quote to 3 lines with a
// "Show more"/"Show less" toggle rather than letting the layout break or
// silently truncating with no way to read the rest.
const QUOTE_CLAMP_THRESHOLD = 200;

function EvidenceQuote({ quote }: { quote: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = quote.length > QUOTE_CLAMP_THRESHOLD;

  return (
    <li className="text-sm text-foreground">
      <span className={cn(!expanded && isLong && "line-clamp-3")}>&ldquo;{quote}&rdquo;</span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="ml-1.5 text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </li>
  );
}

function reasonCopy(reason: StatusReason | undefined): string {
  if (!reason) return STATUS_REASON_FALLBACK;
  return STATUS_REASON_LABELS[reason] ?? STATUS_REASON_FALLBACK;
}

/**
 * Builds the accessible name for the whole card (AC6): state, level (or its
 * absence), confidence, and evidence count, in that order, regardless of
 * how the information is laid out visually. Screen-reader users get this
 * as the card's group label; sighted users get the same facts via the
 * visible badge/labels below.
 */
function buildAccessibleSummary(skill: PortfolioSkill, effectiveLevel: number | null): string {
  const isNotAssessed = skill.assessment_status === "not_assessed";
  const isNeedsReview = skill.assessment_status === "needs_review";
  const isTentative = !isNotAssessed && skill.ai_confidence === "low";

  const parts: string[] = [];

  if (isNotAssessed) {
    parts.push(`Not assessed. ${reasonCopy(skill.status_reason)}`);
  } else if (isTentative) {
    parts.push("Tentative assessment, limited evidence");
  } else {
    parts.push("Assessed");
  }

  parts.push(
    effectiveLevel != null
      ? `Level ${effectiveLevel}, ${LEVEL_DESCRIPTIONS[effectiveLevel] ?? ""}`.trim()
      : "No level assigned"
  );

  if (!isNotAssessed) {
    parts.push(CONFIDENCE_LABELS[skill.ai_confidence]);
  }

  parts.push(
    skill.evidence.length > 0
      ? `${skill.evidence.length} evidence ${skill.evidence.length === 1 ? "quote" : "quotes"}`
      : "No evidence captured"
  );

  if (isNeedsReview) {
    parts.push("Flagged for review");
  }

  return `${skill.skill_label}. ${parts.join(". ")}.`;
}

export default function SkillPortfolioCard({
  skill,
  override,
  onOverrideSaved,
}: SkillPortfolioCardProps) {
  const effectiveLevel = override?.override_level ?? parseLevel(skill.ai_level);
  const isNotAssessed = skill.assessment_status === "not_assessed";
  const isNeedsReview = skill.assessment_status === "needs_review";
  const isTentative = !isNotAssessed && skill.ai_confidence === "low";
  const overridePanelRef = useRef<OverridePanelHandle>(null);

  const accessibleSummary = buildAccessibleSummary(skill, effectiveLevel);

  return (
    <Card role="group" aria-label={accessibleSummary}>
      <CardContent className="p-4 space-y-4">
        {/* Skill header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <LevelBadge
              level={effectiveLevel}
              assessmentStatus={skill.assessment_status}
              confidence={skill.ai_confidence}
            />
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="font-semibold truncate max-w-[16rem]"
                  title={skill.skill_label}
                >
                  {skill.skill_label}
                </span>
                {skill.is_discovered && (
                  <span className="flex items-center gap-0.5 text-xs text-amber-600 shrink-0">
                    <Zap aria-hidden="true" className="h-3 w-3" /> Discovered
                  </span>
                )}
                {isNeedsReview && (
                  <NeedsReviewFlag onActivate={() => overridePanelRef.current?.openAndFocus()} />
                )}
              </div>

              {/* Confidence / not-assessed reason label. Icon + text, never colour alone. */}
              {isNotAssessed ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Not assessed in this interview.</span>{" "}
                  {reasonCopy(skill.status_reason)}
                </p>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {CONFIDENCE_LABELS[skill.ai_confidence]}
                </span>
              )}
            </div>
          </div>
          <OverridePanel
            ref={overridePanelRef}
            skill={skill}
            existingOverride={override}
            onSaved={onOverrideSaved}
          />
        </div>

        {/* Tentative note — low confidence never presents as a firm result */}
        {isTentative && (
          <div className="text-xs text-muted-foreground bg-judgment-tentativeBorder/10 border border-judgment-tentativeBorder/40 rounded px-3 py-2">
            Only briefly explored. This rating is tentative — warrants a dedicated session if this skill matters.
          </div>
        )}

        {/* Evidence */}
        {!isNotAssessed && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Evidence from interview{skill.evidence.length > 0 ? ` (${skill.evidence.length})` : ""}
            </span>
            {skill.evidence.length > 0 ? (
              <ul className="space-y-1">
                {skill.evidence.map((quote, i) => (
                  <EvidenceQuote key={i} quote={quote} />
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground italic">
                <MessageSquareQuote aria-hidden="true" className="h-3.5 w-3.5" />
                No evidence quotes were captured for this skill.
              </p>
            )}
          </div>
        )}

        {/* Competency summary */}
        {skill.competency_summary && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Competency summary
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {skill.competency_summary}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
