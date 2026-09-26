import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SkillPortfolioCard from "@/components/portfolio/SkillPortfolioCard";
import Resource from "@/components/resource/Resource";
import SessionWrongState from "@/components/resource/SessionWrongState";
import PollingStalledBanner from "@/components/resource/PollingStalledBanner";
import { useResource } from "@/hooks/useResource";
import { sessionsApi } from "@/services/sessions";
import { vacanciesApi } from "@/services/vacancies";
import { portfoliosApi } from "@/services/portfolios";
import { usePolling } from "@/hooks/usePolling";
import { sessionHasNoContentYet } from "@/utils/session";
import { ArrowLeft, Download, Loader2, RefreshCw, Zap, FileText } from "lucide-react";
import type { Portfolio, AssessorOverride, Vacancy, Session, FailureCode } from "@/types";

interface SessionResponse {
  session: Session;
  assessment: { id: number; name: string; time_limit_min: number };
}

/**
 * Generation-failure copy, keyed by the backend's `failure_code` (ticket
 * #22). `timeout`/`upstream_error` are transient infra problems worth
 * retrying; `invalid_output`/`unknown` mean the model or pipeline produced
 * something the app can't use, which retrying can't fix — those need an
 * administrator. A `null`/unrecognized code (e.g. a pre-#22 row) falls back
 * to the generic message with a Retry action, matching prior behavior.
 */
const FAILURE_COPY: Record<FailureCode, { message: string; retryable: boolean }> = {
  timeout: {
    message: "Portfolio generation timed out — this is usually a temporary problem.",
    retryable: true,
  },
  upstream_error: {
    message: "Portfolio generation failed because of a temporary problem with the AI service.",
    retryable: true,
  },
  invalid_output: {
    message:
      "Portfolio generation failed because the AI service returned something this app couldn't process.",
    retryable: false,
  },
  unknown: {
    message: "Portfolio generation failed for an unrecognized reason.",
    retryable: false,
  },
};

const GENERIC_FAILURE_MESSAGE = "Portfolio generation failed.";

export default function PortfolioPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();

  const fetchSession = useCallback(() => sessionsApi.get(sessionId!), [sessionId]);
  const { resource } = useResource<SessionResponse>(fetchSession);

  return (
    <Resource
      resource={resource}
      isValidState={(data) => !sessionHasNoContentYet(data.session)}
      wrongState={(data) => (
        <SessionWrongState
          session={data.session}
          contentLabel="portfolio"
          backTo={`/assessments/${id}/invite`}
        />
      )}
    >
      {(data) => (
        <PortfolioPageContent
          id={id!}
          sessionId={sessionId!}
          candidateName={data.session.candidate_name ?? null}
        />
      )}
    </Resource>
  );
}

function PortfolioPageContent({
  id,
  sessionId,
  candidateName,
}: {
  id: string;
  sessionId: string;
  candidateName: string | null;
}) {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<number, AssessorOverride>>({});
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<string>("");
  const [exporting, setExporting] = useState<"pdf" | "json" | null>(null);
  // Announced via an ARIA live region when generation completes while the
  // assessor is still on the page (ticket #25 / AC37), so a screen-reader
  // user gets feedback without losing their place.
  const [announcement, setAnnouncement] = useState("");
  // Tracks whether the assessor was watching a generation-in-progress state
  // across polls, so a fresh page load that lands directly on a completed
  // portfolio doesn't spuriously announce a "just finished" transition.
  const wasGeneratingRef = useRef(false);

  const fetchPortfolio = useCallback(async () => {
    const res = await sessionsApi.getPortfolio(sessionId);
    const data = res.data as any;
    const status = data.portfolio?.generation_status;
    if (data.status === "generating" || status === "generating" || status === "pending") {
      wasGeneratingRef.current = true;
      setGenerating(true);
    } else if (data.portfolio) {
      if (wasGeneratingRef.current && status === "complete") {
        setAnnouncement("Portfolio generation is complete.");
      }
      wasGeneratingRef.current = false;
      setPortfolio(data.portfolio);
      setGenerating(false);
      // Build overrides map
      const overrideMap: Record<number, AssessorOverride> = {};
      data.portfolio.overrides.forEach((o: AssessorOverride) => {
        overrideMap[o.portfolio_skill_id] = o;
      });
      setOverrides(overrideMap);
    }
  }, [sessionId]);

  const handleRetryGeneration = useCallback(async () => {
    await sessionsApi.regeneratePortfolio(sessionId);
    setGenerating(true);
  }, [sessionId]);

  useEffect(() => {
    Promise.all([fetchPortfolio(), vacanciesApi.list()])
      .then(([, vRes]) => {
        setVacancies(vRes.data.vacancies);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchPortfolio]);

  // Poll while generating, backing off on repeated failures (ticket #15).
  const { isStalled: pollingStalled, retry: retryPolling } = usePolling(fetchPortfolio, 5000, generating);

  const handleOverrideSaved = (skillId: number, override: AssessorOverride) => {
    setOverrides((prev) => ({ ...prev, [skillId]: override }));
  };

  const handleRunFitGap = () => {
    if (!selectedVacancy || !portfolio) return;
    navigate(`/assessments/${id}/sessions/${sessionId}/fitgap/${selectedVacancy}`);
  };

  const handleExport = async (format: "pdf" | "json") => {
    if (!portfolio) return;
    setExporting(format);
    try {
      const res = await portfoliosApi.exportPortfolio(
        portfolio.public_id,
        format,
        selectedVacancy || undefined
      );
      if (format === "json") {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([res.data as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `portfolio-${sessionId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Announces generation completing while the assessor is on the page
          (AC37), without disturbing their focus/scroll position. */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Link
            to={`/assessments/${id}/invite`}
            aria-label="Back to sessions"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Portfolio Results</h1>
            {candidateName && (
              <p className="text-sm text-muted-foreground">{candidateName}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            to={`/assessments/${id}/sessions/${sessionId}/transcript`}
            className="inline-flex items-center gap-1 text-sm border rounded-md px-3 py-1.5 hover:bg-accent transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Transcript
          </Link>
          {!generating && portfolio && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("pdf")}
                disabled={!!exporting}
              >
                {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("json")}
                disabled={!!exporting}
              >
                {exporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                JSON
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Generating state */}
      {generating && !pollingStalled && (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <div>
            <p className="font-medium">Generating portfolio...</p>
            <p className="text-sm text-muted-foreground mt-1">
              The AI is analyzing the interview transcript. This takes about 2 minutes.
            </p>
          </div>
        </div>
      )}

      {/* Polling stalled — repeated failures while waiting for the portfolio */}
      {pollingStalled && <PollingStalledBanner onRetry={retryPolling} />}

      {/* Failed state — message and action are driven by `failure_code`
          (ticket #25). A missing/unrecognized code (e.g. a pre-#22 row)
          falls back to the pre-existing generic message + Retry. */}
      {!generating && portfolio?.generation_status === "failed" && (() => {
        const code = portfolio.failure_code;
        const copy = code ? FAILURE_COPY[code] : undefined;
        const message = copy?.message ?? GENERIC_FAILURE_MESSAGE;
        const isRetryable = copy?.retryable ?? true;

        return (
          <div className="border border-destructive/40 rounded-lg p-6 text-center space-y-3">
            <p className="text-sm text-destructive">{message}</p>
            {isRetryable ? (
              <Button variant="outline" size="sm" onClick={handleRetryGeneration}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Retrying won't fix this. Please contact your administrator for help.
              </p>
            )}
          </div>
        );
      })()}

      {/* Ready state */}
      {!generating && portfolio?.generation_status === "complete" && (
        <>
          {/* Configured skills */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Configured Skills</h2>
            {portfolio.skills
              .filter((s) => !s.is_discovered)
              .map((skill) => (
                <SkillPortfolioCard
                  key={skill.id}
                  skill={skill}
                  override={overrides[skill.id]}
                  onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                />
              ))}
          </div>

          {/* Discovered skills */}
          {portfolio.skills.some((s) => s.is_discovered) && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Discovered Skills
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Skills the AI probed that were not in the original assessment
                  </p>
                </div>
                {portfolio.skills
                  .filter((s) => s.is_discovered)
                  .map((skill) => (
                    <SkillPortfolioCard
                      key={skill.id}
                      skill={skill}
                      override={overrides[skill.id]}
                      onOverrideSaved={(o) => handleOverrideSaved(skill.id, o)}
                    />
                  ))}
              </div>
            </>
          )}

          <Separator />

          {/* Fit/Gap */}
          <div className="flex items-center gap-3">
            <Select value={selectedVacancy} onValueChange={setSelectedVacancy}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose vacancy..." />
              </SelectTrigger>
              <SelectContent>
                {vacancies.map((v) => (
                  <SelectItem key={v.public_id} value={v.public_id}>
                    {v.role_title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleRunFitGap} disabled={!selectedVacancy}>
              Run Fit/Gap Analysis →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
