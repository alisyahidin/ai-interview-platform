import React, { useEffect, useRef, useState } from "react";
import { testInternetSpeed, DEFAULT_THRESHOLDS, type InternetSpeedResult } from "@/utils/internetSpeedTest";
import {
    ProctoringState,
    type HardwareCheckingProgress,
    type MicrophoneFailureReason,
    getBrowserInfo,
    getOSInfo,
    checkCamera,
    classifyMicrophoneError,
    getCurrentTime,
} from "@/utils/hardwareUtils";
import { Button } from "@/components/ui/button";
import { sessionsApi } from "@/services/sessions";
import { useT, type Language, type TranslationKey } from "@/hooks/useT";
import { RefreshCw, CheckCircle, XCircle, Loader2, Circle, AlertTriangle } from "lucide-react";

interface HardwareCheckProps {
    onStart?: () => void;
    /** Candidate invite token — needed to acknowledge the connectivity advisory (F10). */
    token?: string;
    /** Interview language, threaded down so this component's copy can localize (ticket #28). */
    language?: Language;
}

// Rough, per-step time budgets (seconds) used only for the progress estimate
// shown to the candidate (F35/AC30) — not a precise SLA.
const STEP_ESTIMATE_SECONDS: Record<keyof HardwareCheckingProgress, number> = {
    osAndBrowser: 1,
    internet: 8,
    camera: 3,
    microphone: 2,
    audio: 1,
};

function StateIcon({ state }: { state: ProctoringState }) {
    if (state === ProctoringState.LOADING)
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (state === ProctoringState.PASSED)
        return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (state === ProctoringState.WARNING)
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    if (state === ProctoringState.ERROR)
        return <XCircle className="h-4 w-4 text-destructive" />;
    return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

function stateLabel(state: ProctoringState, t: (key: TranslationKey) => string) {
    if (state === ProctoringState.LOADING) return t("hardwareCheck.state.checking");
    if (state === ProctoringState.PASSED) return t("hardwareCheck.state.passed");
    if (state === ProctoringState.WARNING) return t("hardwareCheck.state.warning");
    if (state === ProctoringState.ERROR) return t("hardwareCheck.state.failed");
    return t("hardwareCheck.state.waiting");
}

// F12: one distinct (title, body) pair per real getUserMedia failure cause,
// plus an OS-specific recovery step for permission-denied where practical —
// reusing the OS detection the OS/browser step already performs (getOSInfo)
// rather than adding new detection.
function micErrorCopy(
    reason: MicrophoneFailureReason,
    os: string,
    t: (key: TranslationKey) => string
): { title: string; body: string; steps?: string } {
    switch (reason) {
        case "no_device":
            return { title: t("hardwareCheck.mic.noDevice.title"), body: t("hardwareCheck.mic.noDevice.body") };
        case "permission_denied": {
            const steps =
                os === "MacOS"
                    ? t("hardwareCheck.mic.permissionDenied.stepsMac")
                    : os === "Windows"
                        ? t("hardwareCheck.mic.permissionDenied.stepsWindows")
                        : t("hardwareCheck.mic.permissionDenied.stepsGeneric");
            return {
                title: t("hardwareCheck.mic.permissionDenied.title"),
                body: t("hardwareCheck.mic.permissionDenied.body"),
                steps,
            };
        }
        case "device_busy":
            return { title: t("hardwareCheck.mic.busy.title"), body: t("hardwareCheck.mic.busy.body") };
        default:
            return { title: t("hardwareCheck.mic.unknown.title"), body: t("hardwareCheck.mic.unknown.body") };
    }
}

const REQUIRE_CAMERA = import.meta.env.VITE_REQUIRE_CAMERA === "true";

type StepKey = keyof HardwareCheckingProgress;
type Attempts = Record<StepKey, number>;

const INITIAL_PROGRESS: HardwareCheckingProgress = {
    // The OS/browser step is the only one that starts running on mount —
    // every other step is chained forward once its predecessor passes.
    osAndBrowser: ProctoringState.LOADING,
    internet: ProctoringState.WAITING,
    camera: ProctoringState.WAITING,
    audio: ProctoringState.WAITING,
    microphone: ProctoringState.WAITING,
};

const INITIAL_ATTEMPTS: Attempts = { osAndBrowser: 0, internet: 0, camera: 0, audio: 0, microphone: 0 };

const HardwareCheck: React.FC<HardwareCheckProps> = ({ onStart, token, language = "en" }) => {
    const t = useT(language);
    const [progress, setProgress] = useState<HardwareCheckingProgress>(INITIAL_PROGRESS);
    // F11/F35: a per-step generation counter. Retrying a step bumps its own
    // counter and is included in that step's effect dependencies, so the
    // effect genuinely re-runs even when the step's *state value* doesn't
    // change (e.g. it was already stuck at LOADING — the root cause of the
    // F11 bug, where the OS/browser effect's `[]` dependency array meant it
    // never fired again after the first mount, so a retry that reset it back
    // to LOADING silently did nothing).
    const [attempts, setAttempts] = useState<Attempts>(INITIAL_ATTEMPTS);
    const [allPassed, setAllPassed] = useState(false);
    const [internetResult, setInternetResult] = useState<InternetSpeedResult | null>(null);
    const [connectivityAdvisoryAcknowledged, setConnectivityAdvisoryAcknowledged] = useState(false);
    const [micErrorReason, setMicErrorReason] = useState<MicrophoneFailureReason | null>(null);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const osInfoRef = useRef<string>(getOSInfo());

    useEffect(() => {
        const { osAndBrowser, internet, camera, audio, microphone } = progress;
        const internetOk =
            internet === ProctoringState.PASSED ||
            (internet === ProctoringState.WARNING && connectivityAdvisoryAcknowledged);
        setAllPassed(
            osAndBrowser === ProctoringState.PASSED &&
            internetOk &&
            camera === ProctoringState.PASSED &&
            audio === ProctoringState.PASSED &&
            microphone === ProctoringState.PASSED
        );
    }, [progress, connectivityAdvisoryAcknowledged]);

    useEffect(() => {
        if (videoRef.current && videoStream) videoRef.current.srcObject = videoStream;
    }, [videoStream]);

    useEffect(() => {
        return () => { videoStream?.getTracks().forEach((track) => track.stop()); };
    }, [videoStream]);

    const checkAudioPlayback = async (): Promise<boolean> => {
        try {
            const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioCtx();
            if (ctx.state === "suspended") await ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.01, ctx.currentTime);
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.1);
            return true;
        } catch { return false; }
    };

    const startAudioLevelMonitoring = (stream: MediaStream) => {
        try {
            const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioCtx();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const update = () => {
                analyser.getByteFrequencyData(data);
                setAudioLevel(Math.round(data.reduce((a, b) => a + b, 0) / data.length));
                requestAnimationFrame(update);
            };
            update();
        } catch { /* silent */ }
    };

    // Step 1: OS & browser (F11 fix — see `attempts` comment above).
    useEffect(() => {
        if (progress.osAndBrowser !== ProctoringState.LOADING) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            if (cancelled) return;
            getBrowserInfo();
            getOSInfo();
            getCurrentTime();
            setProgress((p) => ({
                ...p,
                osAndBrowser: ProctoringState.PASSED,
                // Only kick off the internet step the first time through —
                // an independent retry of this step alone shouldn't reset
                // steps that already passed.
                internet: p.internet === ProctoringState.WAITING ? ProctoringState.LOADING : p.internet,
            }));
        }, 800);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [progress.osAndBrowser, attempts.osAndBrowser]);

    // Step 2: Internet (F10 fix — advisory, not a hard block).
    useEffect(() => {
        if (progress.internet !== ProctoringState.LOADING) return;
        let cancelled = false;
        testInternetSpeed(DEFAULT_THRESHOLDS).then((result) => {
            if (cancelled) return;
            setInternetResult(result);
            setProgress((p) => {
                // Only chain forward into steps that haven't started yet —
                // an independent retry of the internet step alone (e.g. it
                // already passed once and the candidate re-checks it)
                // shouldn't reset camera/microphone back to LOADING.
                const notStarted = p.camera === ProctoringState.WAITING;
                return {
                    ...p,
                    internet: result.passed ? ProctoringState.PASSED : ProctoringState.WARNING,
                    // Advance automatically only on an outright pass. A warning
                    // waits for the candidate's explicit "Continue anyway"
                    // (see `continueAnyway` below) — informed override, not an
                    // auto-bypassed check.
                    ...(result.passed && notStarted
                        ? REQUIRE_CAMERA
                            ? { camera: ProctoringState.LOADING }
                            : { camera: ProctoringState.PASSED, microphone: ProctoringState.LOADING }
                        : {}),
                };
            });
        });
        return () => { cancelled = true; };
    }, [progress.internet, attempts.internet]);

    // Step 3: Camera + microphone (or microphone-only when camera disabled).
    useEffect(() => {
        const cameraLoading = progress.camera === ProctoringState.LOADING;
        const micLoading = !REQUIRE_CAMERA && progress.microphone === ProctoringState.LOADING;
        if (!cameraLoading && !micLoading) return;

        let cancelled = false;
        (async () => {
            try {
                // F12: the permission request itself must be a direct,
                // un-caught getUserMedia call so a real browser prompt is
                // shown — the failure (if any) is caught *here*, with the
                // real error preserved for classification, not swallowed
                // before the candidate ever saw a prompt.
                const stream = REQUIRE_CAMERA
                    ? await checkCamera()
                    : await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) return;
                if (REQUIRE_CAMERA) setVideoStream(stream);
                startAudioLevelMonitoring(stream);
                setMicErrorReason(null);
                setProgress((p) => ({
                    ...p,
                    ...(REQUIRE_CAMERA ? { camera: ProctoringState.PASSED } : {}),
                    microphone: ProctoringState.PASSED,
                    // Only chain into audio the first time through — an
                    // independent retry of the microphone step alone
                    // shouldn't reset an already-passed audio step.
                    audio: p.audio === ProctoringState.WAITING ? ProctoringState.LOADING : p.audio,
                }));
            } catch (err) {
                if (cancelled) return;
                setMicErrorReason(classifyMicrophoneError(err));
                setProgress((p) => ({
                    ...p,
                    ...(REQUIRE_CAMERA ? { camera: ProctoringState.ERROR } : {}),
                    microphone: ProctoringState.ERROR,
                }));
            }
        })();
        return () => { cancelled = true; };
    }, [progress.camera, progress.microphone, attempts.camera, attempts.microphone]);

    // Step 4: Audio output
    useEffect(() => {
        if (progress.audio !== ProctoringState.LOADING) return;
        let cancelled = false;
        checkAudioPlayback().then((ok) => {
            if (cancelled) return;
            setProgress((p) => ({
                ...p,
                audio: ok ? ProctoringState.PASSED : ProctoringState.ERROR,
            }));
        });
        return () => { cancelled = true; };
    }, [progress.audio, attempts.audio]);

    // F35: each row gets its own retry, independent of every other row —
    // fixing e.g. a plugged-in mic doesn't force redoing checks that already
    // passed.
    const retryStep = (step: StepKey) => {
        setAttempts((a) => ({ ...a, [step]: a[step] + 1 }));
        if (step === "internet") {
            setInternetResult(null);
            setConnectivityAdvisoryAcknowledged(false);
        }
        if (step === "microphone" || step === "camera") {
            setMicErrorReason(null);
            // Camera + microphone share one getUserMedia call when the
            // camera is required, so retrying either row re-acquires both.
            setAttempts((a) => ({
                ...a,
                microphone: step === "microphone" ? a.microphone + 1 : a.microphone,
                camera: REQUIRE_CAMERA ? a.camera + 1 : a.camera,
            }));
            setProgress((p) => ({
                ...p,
                microphone: ProctoringState.LOADING,
                ...(REQUIRE_CAMERA ? { camera: ProctoringState.LOADING } : {}),
            }));
            return;
        }
        setProgress((p) => ({ ...p, [step]: ProctoringState.LOADING }));
    };

    // F10: choosing to continue past the connectivity advisory acknowledges
    // it (best-effort) and always lets the candidate proceed — this call
    // failing must never re-introduce a hard block (D4's whole point).
    const continueAnyway = async () => {
        setConnectivityAdvisoryAcknowledged(true);
        setProgress((p) => {
            if (p.camera !== ProctoringState.WAITING) return p; // already started/settled — don't reset it
            return {
                ...p,
                ...(REQUIRE_CAMERA ? { camera: ProctoringState.LOADING } : { camera: ProctoringState.PASSED, microphone: ProctoringState.LOADING }),
            };
        });
        if (!token) return;
        try {
            await sessionsApi.acknowledgeConnectivityAdvisory(token);
        } catch {
            // Best-effort only — the candidate has already been let through.
        }
    };

    const thresholds = DEFAULT_THRESHOLDS;

    const rows: { key: StepKey; label: TranslationKey }[] = [
        { key: "osAndBrowser", label: "hardwareCheck.step.osAndBrowser" },
        { key: "internet", label: "hardwareCheck.step.internet" },
        ...(REQUIRE_CAMERA ? [{ key: "camera" as const, label: "hardwareCheck.step.camera" as const }] : []),
        { key: "microphone", label: "hardwareCheck.step.microphone" },
        { key: "audio", label: "hardwareCheck.step.audio" },
    ];

    // F35: coarse progress feedback + a time estimate — not a precise
    // measurement, just enough that the candidate isn't left wondering if
    // the page is frozen.
    const doneStates = new Set([ProctoringState.PASSED, ProctoringState.WARNING, ProctoringState.ERROR]);
    const completedCount = rows.filter((r) => doneStates.has(progress[r.key])).length;
    const remainingEstimate = rows
        .filter((r) => !doneStates.has(progress[r.key]))
        .reduce((sum, r) => sum + STEP_ESTIMATE_SECONDS[r.key], 0);
    const stillChecking = completedCount < rows.length;

    // F35: every row is independently retryable once it has settled (passed,
    // warned, or failed) — not just failed ones — so a candidate (or a test)
    // can re-run any single check on its own instead of only ever having a
    // single "retry everything" action.
    const retryableRow = (key: StepKey) =>
        progress[key] === ProctoringState.PASSED ||
        progress[key] === ProctoringState.WARNING ||
        progress[key] === ProctoringState.ERROR;

    return (
        <div className="rounded-lg border bg-card overflow-hidden">
            {/* Progress feedback + time estimate (F35/AC30) */}
            {stillChecking && (
                <div className="px-4 py-2 border-b bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                        {t("hardwareCheck.progress.label")} · {completedCount}/{rows.length}{" "}
                        {t("hardwareCheck.progress.stepsComplete")}
                    </span>
                    {remainingEstimate > 0 && (
                        <span>
                            {t("hardwareCheck.progress.estimatedTimeRemaining")}: ~{remainingEstimate}
                            {t("hardwareCheck.progress.seconds")}
                        </span>
                    )}
                </div>
            )}

            {/* Camera preview */}
            {REQUIRE_CAMERA && <div className="relative bg-black aspect-video">
                {videoStream ? (
                    <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <svg className="w-10 h-10 opacity-30" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                        <p className="text-xs">{t("hardwareCheck.camera.notActive")}</p>
                    </div>
                )}
                {progress.camera === ProctoringState.PASSED && videoStream && (
                    <span className="absolute bottom-2 left-2 flex items-center gap-1 text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        {t("hardwareCheck.camera.live")}
                    </span>
                )}
            </div>}

            {/* Checklist */}
            <div className="divide-y">
                {rows.map(({ key, label }) => (
                    <div key={key} className="px-4 py-3" data-testid={`hardware-row-${key}`}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{t(label)}</span>
                            <div className="flex items-center gap-2">
                                <StateIcon state={progress[key]} />
                                <span className={`text-xs w-24 text-right ${progress[key] === ProctoringState.PASSED ? "text-green-600" :
                                    progress[key] === ProctoringState.WARNING ? "text-yellow-600" :
                                        progress[key] === ProctoringState.ERROR ? "text-destructive" :
                                            "text-muted-foreground"
                                    }`}>
                                    {stateLabel(progress[key], t)}
                                </span>
                                {retryableRow(key) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5"
                                        aria-label={`${t("common.retry")} — ${t(label)}`}
                                        data-testid={`retry-${key}`}
                                        onClick={() => retryStep(key)}
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Internet speed details */}
                        {key === "internet" && internetResult && (
                            <div className="mt-2 flex gap-3 text-xs">
                                <span className={internetResult.download >= thresholds.minDownloadMbps ? "text-green-600" : "text-destructive"}>
                                    ↓ {internetResult.download} Mbps
                                </span>
                                <span className={internetResult.upload >= thresholds.minUploadMbps ? "text-green-600" : "text-destructive"}>
                                    ↑ {internetResult.upload} Mbps
                                </span>
                                <span className={internetResult.ping <= thresholds.maxPingMs ? "text-green-600" : "text-destructive"}>
                                    {internetResult.ping} ms
                                </span>
                            </div>
                        )}

                        {/* F10: connectivity advisory — warning + explicit override, never a hard block */}
                        {key === "internet" && progress.internet === ProctoringState.WARNING && (
                            <div className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
                                {connectivityAdvisoryAcknowledged ? (
                                    <p>{t("hardwareCheck.connectivity.acknowledged")}</p>
                                ) : (
                                    <>
                                        <p className="font-medium">{t("hardwareCheck.connectivity.warningTitle")}</p>
                                        <p className="mt-1">{t("hardwareCheck.connectivity.warningBody")}</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-2 h-7 bg-white"
                                            onClick={continueAnyway}
                                        >
                                            {t("hardwareCheck.connectivity.continueAnyway")}
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* F12: distinct microphone failure copy per real cause */}
                        {key === "microphone" && progress.microphone === ProctoringState.ERROR && micErrorReason && (
                            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                {(() => {
                                    const copy = micErrorCopy(micErrorReason, osInfoRef.current, t);
                                    return (
                                        <>
                                            <p className="font-medium">{copy.title}</p>
                                            <p className="mt-1">{copy.body}</p>
                                            {copy.steps && <p className="mt-1 text-destructive/80">{copy.steps}</p>}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        {/* Mic level bar */}
                        {key === "microphone" && progress.microphone === ProctoringState.PASSED && (
                            <div className="mt-2 flex items-center gap-2">
                                <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className="h-full bg-green-500 transition-all duration-150"
                                        style={{ width: `${Math.min(audioLevel * 2, 100)}%` }}
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground w-8 text-right">{audioLevel}</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t flex items-center justify-end gap-3 bg-muted/30">
                <Button
                    size="sm"
                    disabled={!allPassed}
                    onClick={onStart}
                >
                    {t("hardwareCheck.startInterview")}
                </Button>
            </div>
        </div>
    );
};

export default HardwareCheck;
