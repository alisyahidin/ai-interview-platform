// Hardware utilities for system detection and camera access

export enum ProctoringState {
    WAITING = "waiting",
    LOADING = "loading",
    PASSED = "passed",
    // Ticket #30 (F10/D4): an advisory, non-blocking failure — distinct from
    // ERROR. Only the connectivity step ever enters this state (falling
    // below the speed/ping threshold no longer hard-blocks progress; it
    // shows a warning with an informed "continue anyway" override instead).
    WARNING = "warning",
    ERROR = "error",
}

export type HardwareCheckingProgress = {
    osAndBrowser: ProctoringState;
    internet: ProctoringState;
    camera: ProctoringState;
    audio: ProctoringState;
    microphone: ProctoringState;
};

export function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browser = "Unknown";
    let version = "";
    if (/chrome|crios|crmo/i.test(userAgent)) {
        browser = "Chrome";
        version = userAgent.match(/(chrome|crios|crmo)\/([\d.]+)/i)?.[2] || "";
    } else if (/firefox|fxios/i.test(userAgent)) {
        browser = "Firefox";
        version = userAgent.match(/(firefox|fxios)\/([\d.]+)/i)?.[2] || "";
    } else if (/safari/i.test(userAgent)) {
        browser = "Safari";
        version = userAgent.match(/version\/([\d.]+)/i)?.[1] || "";
    } else if (/edg/i.test(userAgent)) {
        browser = "Edge";
        version = userAgent.match(/edg\/([\d.]+)/i)?.[1] || "";
    }
    return { browser, version };
}

export function getOSInfo() {
    const platform = navigator.platform;
    const userAgent = navigator.userAgent;
    let os = "Unknown";
    if (/Win/i.test(platform)) os = "Windows";
    else if (/Mac/i.test(platform)) os = "MacOS";
    else if (/Linux/i.test(platform)) os = "Linux";
    else if (/Android/i.test(userAgent)) os = "Android";
    else if (/iPhone|iPad|iPod/i.test(userAgent)) os = "iOS";
    return os;
}

// Ticket #30 (F12): the request itself must stay a direct, uncaught
// `getUserMedia` call so the browser actually shows a real permission
// prompt — swallowing the rejection here (the old behavior) meant the
// caller never saw *why* it failed, only that it did. Callers that need to
// classify the failure (see `classifyMicrophoneError` below) catch this
// themselves; callers that don't care can still `.catch(() => null)` it.
export async function checkCamera(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
        video: {
            width: { max: 640 },
            height: { max: 480 },
            frameRate: { max: 20 },
            facingMode: "user",
        },
        audio: true,
    });
}

/**
 * Distinct microphone-failure causes (F12), classified from the real
 * `DOMException.name` `getUserMedia` rejects with — never collapsed into one
 * generic error:
 *   - "no_device": no microphone connected (`NotFoundError`/`OverconstrainedError`).
 *   - "permission_denied": the browser/OS blocked access
 *     (`NotAllowedError`/`PermissionDeniedError`, the latter being older
 *     Safari/Firefox naming for the same thing).
 *   - "device_busy": another application is already holding the device
 *     (`NotReadableError`/`TrackStartError`, same distinction, older naming).
 *   - "unknown": anything else (e.g. `AbortError`, a non-DOMException throw) —
 *     falls back to a generic message rather than guessing.
 */
export type MicrophoneFailureReason =
    | "no_device"
    | "permission_denied"
    | "device_busy"
    | "unknown";

export function classifyMicrophoneError(error: unknown): MicrophoneFailureReason {
    const name =
        error instanceof DOMException
            ? error.name
            : typeof error === "object" && error !== null && "name" in error
                ? String((error as { name?: unknown }).name)
                : undefined;

    switch (name) {
        case "NotFoundError":
        case "OverconstrainedError":
            return "no_device";
        case "NotAllowedError":
        case "PermissionDeniedError":
            return "permission_denied";
        case "NotReadableError":
        case "TrackStartError":
            return "device_busy";
        default:
            return "unknown";
    }
}

export function getCurrentTime(): string {
    const now = new Date();
    return now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function getCurrentDate(): string {
    const now = new Date();
    return now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
