import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import TranscriptBubble from "@/components/interview/TranscriptBubble";
import Resource from "@/components/resource/Resource";
import WrongStateState from "@/components/resource/WrongStateState";
import PollingStalledBanner from "@/components/resource/PollingStalledBanner";
import { useResource } from "@/hooks/useResource";
import { usePolling } from "@/hooks/usePolling";
import { useCoverageWebSocket, type CoverageConnectionState } from "@/hooks/useCoverageWebSocket";
import { sessionsApi } from "@/services/sessions";
import {
  COVERAGE_STATE_LABELS,
  COVERAGE_STATE_WIDTH,
  COVERAGE_STATE_COLOR,
} from "@/utils/constants";
import { ArrowLeft, CheckCircle, Clock, Radio, Zap } from "lucide-react";
import type { Session, TranscriptTurn } from "@/types";

const TRANSCRIPT_POLL_BASE_MS = 3000;

interface LiveMonitorData {
  session: Session;
  assessmentName: string;
  initialTranscript: TranscriptTurn[];
}

async function fetchLiveMonitorData(sessionId: string): Promise<{ data: LiveMonitorData }> {
  const [sRes, tRes] = await Promise.all([
    sessionsApi.get(sessionId),
    sessionsApi.getTranscript(sessionId),
  ]);
  return {
    data: {
      session: sRes.data.session,
      assessmentName: sRes.data.assessment?.name ?? "",
      initialTranscript: tRes.data.turns,
    },
  };
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <span className="flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {mm}:{ss}
    </span>
  );
}

/** Passive "last updated Xs ago" metadata — never an alarming indicator. */
function LastUpdatedLabel({ at }: { at: Date }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const seconds = Math.max(0, Math.floor((Date.now() - at.getTime()) / 1000));
  return <span>last updated {seconds}s ago</span>;
}

function ConnectionStatus({
  connectionState,
  lastUpdatedAt,
  onReconnect,
}: {
  connectionState: CoverageConnectionState;
  lastUpdatedAt: Date | null;
  onReconnect: () => void;
}) {
  switch (connectionState) {
    case "connecting":
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Radio className="h-3 w-3" />
          Connecting...
        </span>
      );
    case "connected":
      return (
        <span className="flex items-center gap-1.5 text-xs text-green-600">
          <Radio className="h-3 w-3" />
          <span>Live</span>
          {lastUpdatedAt && (
            <span className="text-muted-foreground font-normal">
              &middot; <LastUpdatedLabel at={lastUpdatedAt} />
            </span>
          )}
        </span>
      );
    case "reconnecting":
      return (
        <span className="flex items-center gap-1 text-xs text-amber-600">
          <Radio className="h-3 w-3" />
          Reconnecting...
        </span>
      );
    case "gave-up":
      return (
        <span className="flex items-center gap-2 text-xs text-destructive">
          <span className="flex items-center gap-1">
            <Radio className="h-3 w-3" />
            Connection lost
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={onReconnect}
          >
            Reconnect
          </Button>
        </span>
      );
    default: {
      const exhaustive: never = connectionState;
      return exhaustive;
    }
  }
}

function LiveMonitorSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function LiveMonitorWrongState({
  id,
  sessionId,
  session,
}: {
  id?: string;
  sessionId?: string;
  session: Session;
}) {
  const ended = session.status === "ended";
  return (
    <div className="max-w-2xl mx-auto">
      <WrongStateState
        title={ended ? "This session has ended" : "This session hasn't started yet"}
        description={
          ended
            ? "Live monitoring is only available while an interview is in progress. View the portfolio for the completed results instead."
            : "Live monitoring will be available once the candidate begins the interview."
        }
        backTo={
          ended
            ? `/assessments/${id}/sessions/${sessionId}/portfolio`
            : `/assessments/${id}/invite`
        }
        backLabel={ended ? "View portfolio" : "Back to sessions"}
      />
    </div>
  );
}

interface LiveMonitorContentProps {
  id?: string;
  sessionId: string;
  initialSession: Session;
  assessmentName: string;
  initialTranscript: TranscriptTurn[];
  onViewPortfolio: () => void;
}

function LiveMonitorContent({
  id,
  sessionId,
  initialSession,
  assessmentName,
  initialTranscript,
  onViewPortfolio,
}: LiveMonitorContentProps) {
  const [transcript, setTranscript] = useState<TranscriptTurn[]>(() =>
    initialTranscript.slice(-10)
  );
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(false);
  // The session was `active` at fetch time (guaranteed by `isValidState`);
  // this tracks whether it still is, per the WS's `session_ended` signal.
  const [sessionActive, setSessionActive] = useState(true);
  const lastTurnRef = useRef<number>(
    initialTranscript.length > 0
      ? initialTranscript[initialTranscript.length - 1].turn_number
      : 0
  );

  // Only mounted while the session is active (see the `<Resource>` wiring in
  // `LiveMonitorPage`), so this is the only place the coverage WebSocket is
  // ever constructed — a non-active session never reaches this component.
  const { coverageMap, sessionEnded, sessionEndReason, connectionState, lastUpdatedAt, reconnect } =
    useCoverageWebSocket(sessionId);

  // On session_ended from WS — stop polling, update local state
  useEffect(() => {
    if (sessionEnded) {
      setSessionActive(false);
    }
  }, [sessionEnded]);

  const fetchNewTurns = useCallback(async () => {
    const res = await sessionsApi.getTranscript(sessionId, lastTurnRef.current + 1);
    if (res.data.turns.length > 0) {
      setTranscript((prev) => [...prev, ...res.data.turns].slice(-10));
      lastTurnRef.current = res.data.turns[res.data.turns.length - 1].turn_number;
    }
  }, [sessionId]);

  const { isStalled: pollingStalled, retry: retryPolling } = usePolling(
    fetchNewTurns,
    TRANSCRIPT_POLL_BASE_MS,
    sessionActive
  );

  const handleEndSession = async () => {
    setEnding(true);
    try {
      await sessionsApi.endSession(sessionId);
      onViewPortfolio();
    } catch {
      setEnding(false);
      setEndError(true);
    }
  };

  const configuredSkills = coverageMap?.skills ?? [];
  const discoveredSkills = coverageMap?.discovered ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link to={`/assessments/${id}/invite`} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-semibold">Live Monitor</h1>
          </div>
          {assessmentName && (
            <p className="text-sm text-muted-foreground pl-6">{assessmentName}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {initialSession.started_at && sessionActive && (
            <ElapsedTimer startedAt={initialSession.started_at} />
          )}
          <ConnectionStatus
            connectionState={connectionState}
            lastUpdatedAt={lastUpdatedAt}
            onReconnect={reconnect}
          />
        </div>
      </div>

      {/* Session ended banner */}
      {sessionEnded && (
        <div className="flex items-center gap-2 text-sm bg-muted/50 border rounded-lg px-4 py-3">
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          <div>
            <span className="font-medium">Session ended</span>
            {sessionEndReason && (
              <span className="text-muted-foreground ml-1.5">
                — {sessionEndReason.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={onViewPortfolio}
          >
            View portfolio →
          </Button>
        </div>
      )}

      {/* Coverage map */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Coverage Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {configuredSkills.length === 0 && discoveredSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground">Waiting for interview to begin...</p>
          ) : (
            configuredSkills.map((skill) => (
              <div key={skill.id ?? skill.skill_label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{skill.skill_label}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {skill.probe_count > 0 && (
                      <span>{skill.probe_count} probe{skill.probe_count !== 1 ? "s" : ""}</span>
                    )}
                    <span className="capitalize">{COVERAGE_STATE_LABELS[skill.state]}</span>
                  </div>
                </div>
                <Progress
                  value={COVERAGE_STATE_WIDTH[skill.state]}
                  indicatorClassName={COVERAGE_STATE_COLOR[skill.state]}
                  className="h-2"
                />
                {skill.last_signal && (
                  <p className="text-xs text-muted-foreground truncate">
                    "{skill.last_signal}"
                  </p>
                )}
              </div>
            ))
          )}

          {/* Discovered skills */}
          {discoveredSkills.length > 0 && (
            <>
              {configuredSkills.length > 0 && <Separator />}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Discovered
                </p>
                {discoveredSkills.map((skill) => (
                  <div key={skill.id ?? skill.skill_label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-amber-500" />
                        {skill.skill_label}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {skill.probe_count > 0 && (
                          <span>{skill.probe_count} probe{skill.probe_count !== 1 ? "s" : ""}</span>
                        )}
                        <span className="capitalize">{COVERAGE_STATE_LABELS[skill.state]}</span>
                      </div>
                    </div>
                    <Progress
                      value={COVERAGE_STATE_WIDTH[skill.state]}
                      indicatorClassName="bg-amber-400"
                      className="h-2"
                    />
                    {skill.last_signal && (
                      <p className="text-xs text-muted-foreground truncate">
                        "{skill.last_signal}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Live transcript */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Live Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcript yet.</p>
          ) : (
            <div className="space-y-2">
              {transcript.map((turn) => (
                <TranscriptBubble key={turn.id} speaker={turn.speaker} text={turn.text} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transcript polling stalled — repeated failures fetching new turns */}
      {pollingStalled && <PollingStalledBanner onRetry={retryPolling} />}

      {endError && (
        <div className="border border-destructive/40 rounded-lg p-3 text-sm text-destructive">
          Failed to end session. Please try again.
        </div>
      )}

      {/* End Session */}
      <div className="flex justify-end">
        {sessionActive ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={ending}>
                {ending ? "Ending..." : "End Session"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>End the session now?</AlertDialogTitle>
                <AlertDialogDescription>
                  The interview will stop and portfolio generation will begin.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleEndSession}>End Session</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button variant="outline" onClick={onViewPortfolio}>
            View portfolio →
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LiveMonitorPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();

  const fetcher = useCallback(() => fetchLiveMonitorData(sessionId!), [sessionId]);
  const { resource } = useResource(fetcher);

  const goToPortfolio = useCallback(
    () => navigate(`/assessments/${id}/sessions/${sessionId}/portfolio`),
    [navigate, id, sessionId]
  );

  return (
    <Resource
      resource={resource}
      isValidState={(data) => data.session.status === "active"}
      loading={<LiveMonitorSkeleton />}
      wrongState={(data) => (
        <LiveMonitorWrongState id={id} sessionId={sessionId} session={data.session} />
      )}
    >
      {(data) => (
        <LiveMonitorContent
          id={id}
          sessionId={sessionId!}
          initialSession={data.session}
          assessmentName={data.assessmentName}
          initialTranscript={data.initialTranscript}
          onViewPortfolio={goToPortfolio}
        />
      )}
    </Resource>
  );
}
