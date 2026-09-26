import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assessmentsApi } from "@/services/assessments";
import { usePolling } from "@/hooks/usePolling";
import PollingStalledBanner from "@/components/resource/PollingStalledBanner";
import SessionTable from "@/components/sessions/SessionTable";
import SessionSummary from "@/components/sessions/SessionSummary";
import { LEVEL_LABELS } from "@/utils/constants";
import { sessionPresentation } from "@/utils/sessionStatus";
import {
  countByPresentation,
  filterSessions,
  type SessionFilter,
} from "@/utils/sessionFilter";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import type { Assessment, Session } from "@/types";

export default function AssessmentInvitePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [candidateNameInput, setCandidateNameInput] = useState("");
  // The one selection the summary layer's cards and tabs both write, so the
  // two cannot end up describing different tables.
  const [statusFilter, setStatusFilter] = useState<SessionFilter>("all");
  const [query, setQuery] = useState("");
  const [freshSessionId, setFreshSessionId] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await assessmentsApi.getSessions(Number(id));
    setSessions(res.data.sessions);
  }, [id]);

  useEffect(() => {
    Promise.all([
      assessmentsApi.get(Number(id)),
      assessmentsApi.getSessions(Number(id)),
    ]).then(([aRes, sRes]) => {
      setAssessment(aRes.data.assessment);
      setSessions(sRes.data.sessions);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  // Poll while any session is live or pending
  const hasActiveSessions = sessions.some((s) => s.status !== "ended");
  const { isStalled: pollingStalled, retry: retryPolling } = usePolling(
    loadSessions,
    5000,
    hasActiveSessions
  );

  const openInviteDialog = () => {
    setCandidateNameInput("");
    setShowInviteDialog(true);
  };

  const handleInviteCandidate = async () => {
    setCreatingSession(true);
    setShowInviteDialog(false);
    try {
      const res = await assessmentsApi.createSession(Number(id), candidateNameInput.trim() || undefined);
      // The new invite is a row in the list, marked as fresh: the list already
      // shows this session, so a second surface restated it. Only its id is
      // kept — the row itself is `sessions`, which polling owns from here.
      setSessions((prev) => [res.data.session, ...prev]);
      setFreshSessionId(res.data.session.id);
    } finally {
      setCreatingSession(false);
    }
  };

  // Counts are taken from the whole cohort and the rows from the narrowed
  // list, so the summary keeps describing the Assessment rather than the
  // current view of it.
  const counts = useMemo(() => countByPresentation(sessions), [sessions]);
  const visibleSessions = useMemo(
    () => filterSessions(sessions, statusFilter, query),
    [sessions, statusFilter, query]
  );

  // The fresh-invite highlight reads the polled list rather than a clock: it
  // holds while the session it marks is still awaiting its candidate, and the
  // moment polling reports otherwise it is gone. Nothing has to expire it, so
  // it cannot outlive the moment it was meant to describe.
  const freshSession =
    freshSessionId === null
      ? null
      : (sessions.find((session) => session.id === freshSessionId) ?? null);
  const highlightedId =
    freshSession && sessionPresentation(freshSession) === "awaiting_candidate"
      ? freshSession.id
      : null;

  const copyLink = (session: Session) => {
    navigator.clipboard.writeText(session.invite_url);
    setCopiedId(session.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2 min-w-0">
            <Link to="/assessments" className="text-muted-foreground hover:text-foreground mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{assessment?.name ?? "—"}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {assessment?.time_limit_min} min time limit — share an invite link with each
                candidate, then monitor the session as it runs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate(`/assessments/${id}/edit`)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
            <Button size="sm" onClick={openInviteDialog} disabled={creatingSession}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {creatingSession ? "Creating..." : "Invite Candidate"}
            </Button>
          </div>
        </div>

        {/* Assessed skills — a wrapping chip row, so every assessed skill stays
            visible rather than being truncated behind a "N skills" count. */}
        {assessment?.skills && assessment.skills.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Assessed skills">
            {assessment.skills.map((s) => (
              <li
                key={s.id ?? s.skill_label}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs"
              >
                <span className="font-medium">{s.skill_label}</span>
                <span className="text-muted-foreground">{LEVEL_LABELS[s.expected_level]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite candidate dialog */}
      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite Candidate</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="candidate-name">Candidate name</Label>
            <Input
              id="candidate-name"
              placeholder="e.g. Budi Santoso"
              value={candidateNameInput}
              onChange={(e) => setCandidateNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInviteCandidate()}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">Optional — helps you identify this session later.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteDialog(false)}>Cancel</Button>
            <Button onClick={handleInviteCandidate}>Create Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Polling stalled — repeated failures refreshing candidate status */}
      {pollingStalled && <PollingStalledBanner onRetry={retryPolling} />}

      {/* Summary layer — what the cohort looks like, and the two ways of
          narrowing it. Cards and tabs write the same selection, so they read
          the same table. */}
      <SessionSummary
        counts={counts}
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        query={query}
        onQueryChange={setQuery}
      />

      {/* Sessions list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Candidates</h2>

        <SessionTable
          sessions={visibleSessions}
          total={sessions.length}
          assessmentId={id!}
          onCopy={copyLink}
          copiedId={copiedId}
          highlightedId={highlightedId}
        />
      </div>
    </div>
  );
}
