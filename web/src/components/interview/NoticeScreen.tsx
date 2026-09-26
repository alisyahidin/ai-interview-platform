import { useId, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";
import type { Language } from "@/lib/i18n/dictionary";

// Support contact shown on the notice — overridable per deployment, matching
// the `VITE_*` env-var convention used elsewhere (see `.env.example`).
const SUPPORT_CONTACT =
  (import.meta.env.VITE_SUPPORT_CONTACT as string | undefined) ?? "support@example.com";

export interface NoticeScreenProps {
  /** Candidate's interview language, from `candidate_info.language` (ticket #29). Defaults to English. */
  language?: Language;
  /** Called once the candidate has explicitly acknowledged the notice. */
  onAcknowledge: () => void;
  /** True while the acknowledgment call is in flight — disables the action to prevent double-submits. */
  isSubmitting?: boolean;
  /** Set when the last acknowledgment attempt failed, so the candidate can retry. */
  hasError?: boolean;
}

/**
 * Pre-hardware-check consent/notice screen (F14, AC27). Self-contained:
 * `InterviewPage` renders this in place of the hardware-check step until the
 * candidate explicitly acknowledges it — no microphone access happens before
 * this component's "continue" action fires.
 *
 * The acknowledgment gate is a real, deliberate interaction (a checkbox that
 * must be checked before the button enables), never satisfied by scrolling
 * or a timeout, and both controls are plain native elements so they're
 * keyboard-operable for free and the button carries a real accessible name.
 */
export default function NoticeScreen({
  language = "en",
  onAcknowledge,
  isSubmitting = false,
  hasError = false,
}: NoticeScreenProps) {
  const t = useT(language);
  const [checked, setChecked] = useState(false);
  const checkboxId = useId();

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center gap-2">
        <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t("notice.title")}</h1>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3 text-left text-muted-foreground">
        <p>{t("notice.recording")}</p>
        <p>{t("notice.aiInvolvement")}</p>
        <p>{t("notice.purpose")}</p>
        <p>
          {t("notice.contactLabel")}{" "}
          <a href={`mailto:${SUPPORT_CONTACT}`} className="underline text-foreground">
            {SUPPORT_CONTACT}
          </a>
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          id={checkboxId}
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <label htmlFor={checkboxId} className="text-sm cursor-pointer">
          {t("notice.acknowledgeLabel")}
        </label>
      </div>

      {hasError && (
        <p role="alert" className="text-sm text-destructive">
          {t("notice.error")}
        </p>
      )}

      <Button className="w-full" size="lg" disabled={!checked || isSubmitting} onClick={onAcknowledge}>
        {t("notice.continueButton")}
      </Button>
    </div>
  );
}
