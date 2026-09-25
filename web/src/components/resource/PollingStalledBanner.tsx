import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PollingStalledBannerProps {
  /** Invoked by the "Retry now" button — typically `usePolling().retry`. */
  onRetry: () => void;
  className?: string;
}

/**
 * Shown when `usePolling` gives up retrying after repeated failures. Shared
 * across every page that polls (AssessmentInvitePage, FitGapReportPage,
 * PortfolioPage, LiveMonitorPage) so the visual style and copy stay in sync
 * instead of drifting per page.
 */
export default function PollingStalledBanner({ onRetry, className }: PollingStalledBannerProps) {
  return (
    <div className={cn("border border-amber-400/40 rounded-lg p-6 text-center space-y-3", className)}>
      <p className="text-sm text-amber-700">
        We've stopped retrying automatically after repeated failures.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry now
      </Button>
    </div>
  );
}
