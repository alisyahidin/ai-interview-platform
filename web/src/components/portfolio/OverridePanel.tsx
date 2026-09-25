import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import LevelRadio from "@/components/assessment/LevelRadio";
import LevelBadge from "./LevelBadge";
import { portfoliosApi } from "@/services/portfolios";
import { Loader2, Pencil } from "lucide-react";
import { parseLevel } from "@/utils/constants";
import type { PortfolioSkill, AssessorOverride } from "@/types";

interface OverridePanelProps {
  skill: PortfolioSkill;
  existingOverride?: AssessorOverride;
  onSaved: (override: AssessorOverride) => void;
}

// Imperative handle so a `needs_review` CTA elsewhere on the card (see
// NeedsReviewFlag/SkillPortfolioCard, ticket #23 AC4) can open this panel
// and move focus/scroll to it without this component knowing anything
// about who's asking.
export interface OverridePanelHandle {
  openAndFocus: () => void;
}

const OverridePanel = forwardRef<OverridePanelHandle, OverridePanelProps>(function OverridePanel(
  { skill, existingOverride, onSaved },
  ref
) {
  const [open, setOpen] = useState(false);
  const [overrideLevel, setOverrideLevel] = useState(
    existingOverride?.override_level ?? parseLevel(skill.ai_level) ?? 1
  );
  const [notes, setNotes] = useState(existingOverride?.assessor_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = useState(false);

  const hasOverride = !!existingOverride;

  useImperativeHandle(ref, () => ({
    openAndFocus: () => {
      setOpen(true);
      setPendingFocus(true);
    },
  }));

  useEffect(() => {
    if (!open || !pendingFocus) return;
    // jsdom (and some older browsers) don't implement scrollIntoView at
    // all — guard the call itself rather than assuming it exists.
    panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    panelRef.current?.focus();
    setPendingFocus(false);
  }, [open, pendingFocus]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      const res = await portfoliosApi.getOverride(skill.id, {
        override_level: overrideLevel,
        assessor_notes: notes,
      });
      onSaved(res.data.override);
      setOpen(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {hasOverride ? (
          <>
            <div className="flex items-center gap-1.5 text-sm">
              <LevelBadge
                level={parseLevel(skill.ai_level)}
                assessmentStatus={skill.assessment_status}
                confidence={skill.ai_confidence}
                size="sm"
              />
              <span className="text-muted-foreground text-xs">AI</span>
              <span className="text-muted-foreground">→</span>
              <LevelBadge level={existingOverride!.override_level} assessmentStatus="assessed" size="sm" />
              <span className="text-xs text-green-600 font-medium">You Overridden ✓</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              <Pencil className="h-3 w-3 mr-1" /> Edit override
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Override rating ▼
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label="Override rating"
      className="border rounded-lg p-4 space-y-3 bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Override
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Your rating:</Label>
        <LevelRadio value={overrideLevel} onChange={setOverrideLevel} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`notes-${skill.id}`} className="text-sm">Notes (optional):</Label>
        <Textarea
          id={`notes-${skill.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add context for your override..."
        />
      </div>

      {saveError && (
        <p className="text-xs text-destructive">Failed to save override. Please try again.</p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save override
        </Button>
      </div>
    </div>
  );
});

export default OverridePanel;
