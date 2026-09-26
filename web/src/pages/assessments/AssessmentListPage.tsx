import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assessmentsApi } from "@/services/assessments";
import { sessionsApi } from "@/services/sessions";
import { Plus, Clock, ChevronRight, RefreshCw, Loader2, Copy, Check } from "lucide-react";
import type { Assessment } from "@/types";

// A session is in the terminal failed state (backend `Session#failed?`:
// `ended? && end_reason == 'error'`) — the only state re-invite is offered
// from. Not shown for active or successfully-completed sessions.
function isFailedSession(session?: Assessment["latest_session"]): boolean {
  return !!session && session.status === "ended" && session.end_reason === "error";
}

function SessionSummary({
  session,
  onReinvite,
  isReinviting,
}: {
  session?: Assessment["latest_session"];
  onReinvite: (e: React.MouseEvent) => void;
  isReinviting: boolean;
}) {
  if (!session) return null;

  const statusText = (() => {
    if (session.status === "active")
      return (
        <span className="flex items-center gap-1 text-xs text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Live now
        </span>
      );

    if (isFailedSession(session))
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-destructive">Last: failed</span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={isReinviting}
            onClick={onReinvite}
          >
            {isReinviting ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Re-inviting...</>
            ) : (
              <><RefreshCw className="h-3 w-3 mr-1" /> Re-invite</>
            )}
          </Button>
        </span>
      );

    if (session.status === "ended")
      return <span className="text-xs text-muted-foreground">Last: completed</span>;

    return <span className="text-xs text-muted-foreground">Awaiting candidate</span>;
  })();

  // #27's implementation decision: a session the candidate chose to continue
  // on a weak connection surfaces a small inline note here, regardless of
  // whether it ultimately succeeded, failed, or is still active/pending.
  return (
    <span className="flex items-center gap-1.5">
      {statusText}
      {session.connectivity_advisory_acknowledged && (
        <span className="text-xs text-amber-600">
          ⚠ Candidate continued on a weak connection
        </span>
      )}
    </span>
  );
}

export default function AssessmentListPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const [reinvitingId, setReinvitingId] = useState<number | null>(null);
  const [reinviteError, setReinviteError] = useState<string | null>(null);
  const [reinviteResult, setReinviteResult] = useState<{
    inviteUrl: string;
    candidateName?: string;
  } | null>(null);
  const [reinviteLinkCopied, setReinviteLinkCopied] = useState(false);

  useEffect(() => {
    assessmentsApi
      .list()
      .then((res) => setAssessments(res.data.assessments))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleReinvite = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setReinviteError(null);
    setReinvitingId(sessionId);
    try {
      const res = await sessionsApi.reinvite(sessionId);
      setReinviteResult({
        inviteUrl: res.data.invite_url,
        candidateName: res.data.session.candidate_name,
      });
    } catch {
      setReinviteError("Failed to re-invite candidate. Please try again.");
    } finally {
      setReinvitingId(null);
    }
  };

  const copyReinviteLink = () => {
    if (!reinviteResult?.inviteUrl) return;
    navigator.clipboard.writeText(reinviteResult.inviteUrl);
    setReinviteLinkCopied(true);
    setTimeout(() => setReinviteLinkCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Assessments</h1>
        <Button onClick={() => navigate("/assessments/new")}>
          <Plus className="h-4 w-4 mr-1.5" /> New Assessment
        </Button>
      </div>

      {error && (
        <div className="border border-destructive/40 rounded-lg p-4 text-sm text-destructive">
          Failed to load assessments. Please refresh the page.
        </div>
      )}

      {reinviteError && (
        <div className="border border-destructive/40 rounded-lg p-4 text-sm text-destructive">
          {reinviteError}
        </div>
      )}

      {/* Re-invite result — reuses the invite-link-sharing pattern from AssessmentInvitePage */}
      <Dialog
        open={!!reinviteResult}
        onOpenChange={(open) => {
          if (!open) {
            setReinviteResult(null);
            setReinviteLinkCopied(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Re-invite sent</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm font-medium">
              {reinviteResult?.candidateName ? (
                <>New link for <span className="font-semibold">{reinviteResult.candidateName}</span> ready — share with your candidate:</>
              ) : (
                <>New invite link ready — share with your candidate:</>
              )}
            </p>
            <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-white">
              <span className="flex-1 text-sm font-mono truncate text-muted-foreground">
                {reinviteResult?.inviteUrl}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={copyReinviteLink} className="w-full">
              {reinviteLinkCopied ? (
                <><Check className="h-3.5 w-3.5 mr-1.5" /> Copied!</>
              ) : (
                <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy link</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : assessments.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-sm text-muted-foreground">
          <p className="mb-3">No assessments yet.</p>
          <Button variant="outline" onClick={() => navigate("/assessments/new")}>
            <Plus className="h-4 w-4 mr-1.5" /> Create your first assessment
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {assessments.map((a) => (
            <Card
              key={a.public_id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => navigate(`/assessments/${a.public_id}/invite`)}
            >
              <CardContent className="py-3 px-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{a.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {a.time_limit_min} min
                    </span>
                    {a.latest_session && (
                      <>
                        <span>·</span>
                        <SessionSummary
                          session={a.latest_session}
                          isReinviting={reinvitingId === a.latest_session.id}
                          onReinvite={(e) => handleReinvite(a.latest_session!.id, e)}
                        />
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
