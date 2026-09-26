import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import HardwareCheck from "./HardwareCheck";
import { sessionsApi } from "@/services/sessions";
import * as internetSpeedTest from "@/utils/internetSpeedTest";
import type { InternetSpeedResult } from "@/utils/internetSpeedTest";

// Covers ticket #30's patch to the existing HardwareCheck state machine:
//   - F11: the OS/browser step's retry genuinely re-runs the check (it used
//     to get permanently stuck at "Checking..." because its effect had an
//     empty dependency array and never fired again).
//   - F10: a connectivity failure is an advisory (warning + "Continue
//     anyway"), never a hard block.
//   - F12: microphone failures are classified by the real getUserMedia
//     error into three distinct, differently-worded causes.
//   - F35: every row (not just failed ones) carries its own independent
//     retry action, plus coarse progress/estimate feedback.
// This does not re-derive useT/dictionary fallback behavior (see
// useT.test.ts) or the internet speed-test math itself (untouched by this
// ticket — only how HardwareCheck reacts to its `passed` flag changed).
const API_BASE = "http://localhost:3001/api/v1";
const TOKEN = "tok-abc123";

function speedResult(overrides: Partial<InternetSpeedResult>): InternetSpeedResult {
    return {
        download: 50,
        upload: 20,
        ping: 40,
        passed: true,
        downloadTests: [],
        uploadTests: [],
        pingTests: [],
        ...overrides,
    };
}

function fakeStream(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

function mockGetUserMedia(impl: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn(impl) },
        configurable: true,
    });
}

function setPlatform(platform: string) {
    Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
        return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() } };
    }
    createGain() {
        return { connect: vi.fn(), gain: { setValueAtTime: vi.fn() } };
    }
    createMediaStreamSource() {
        return { connect: vi.fn() };
    }
    createAnalyser() {
        return { fftSize: 0, frequencyBinCount: 8, connect: vi.fn(), getByteFrequencyData: vi.fn() };
    }
    resume() {
        return Promise.resolve();
    }
}

async function waitForRowState(key: string, text: RegExp | string) {
    const row = await screen.findByTestId(`hardware-row-${key}`, {}, { timeout: 3000 });
    await waitFor(() => expect(within(row).getByText(text)).toBeInTheDocument(), { timeout: 3000 });
    return row;
}

describe("HardwareCheck", () => {
    beforeEach(() => {
        vi.stubGlobal("AudioContext", FakeAudioContext);
        vi.stubGlobal("requestAnimationFrame", () => 0);
        mockGetUserMedia(() => Promise.resolve(fakeStream()));
        vi.spyOn(internetSpeedTest, "testInternetSpeed").mockResolvedValue(speedResult({}));
        setPlatform("");
        server.use(
            http.post(`${API_BASE}/sessions/:token/connectivity_advisory`, () =>
                HttpResponse.json({ data: { session_id: 1, connectivity_advisory_acknowledged: "2026-01-01T00:00:00Z" } })
            )
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("runs the OS/browser check on mount, then chains into internet/mic/audio and enables Start Interview", async () => {
        const onStart = vi.fn();
        render(<HardwareCheck onStart={onStart} token={TOKEN} />);

        await waitForRowState("osAndBrowser", "Checking…");
        await waitForRowState("osAndBrowser", "Passed");
        await waitForRowState("internet", "Passed");
        await waitForRowState("microphone", "Passed");
        await waitForRowState("audio", "Passed");

        const startButton = screen.getByRole("button", { name: "Start Interview" });
        await waitFor(() => expect(startButton).toBeEnabled());

        await userEvent.click(startButton);
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    // F11 regression: previously the OS/browser effect had an empty `[]`
    // dependency array, so resetting it back to LOADING (e.g. via retry)
    // never re-triggered the check — it was stuck at "Checking..." forever.
    it("retrying the OS/browser step after it has passed genuinely re-runs it (F11)", async () => {
        render(<HardwareCheck token={TOKEN} />);

        await waitForRowState("osAndBrowser", "Passed");

        const row = screen.getByTestId("hardware-row-osAndBrowser");
        const retryButton = within(row).getByTestId("retry-osAndBrowser");
        await userEvent.click(retryButton);

        // Genuinely re-runs: goes back to "Checking...", not stuck, and
        // resolves to "Passed" again rather than staying on "Checking..."
        // forever (the F11 bug).
        await waitFor(() => expect(within(row).getByText("Checking…")).toBeInTheDocument());
        await waitFor(() => expect(within(row).getByText("Passed")).toBeInTheDocument(), { timeout: 3000 });

        // Retrying the first step alone must not have reset steps further
        // down the chain that had already started/passed.
        await waitForRowState("internet", "Passed");
    });

    // F10/AC29: falling below the threshold is an advisory, never a hard
    // block — the candidate can always choose to continue.
    it("shows a connectivity advisory with continue-anyway on failure, and never hard-blocks progress", async () => {
        vi.mocked(internetSpeedTest.testInternetSpeed).mockResolvedValue(
            speedResult({ passed: false, download: 1, upload: 0.5, ping: 900 })
        );
        const ackSpy = vi.spyOn(sessionsApi, "acknowledgeConnectivityAdvisory");

        render(<HardwareCheck token={TOKEN} />);

        const internetRow = await waitForRowState("internet", "Needs attention");
        // Never an ERROR/hard-blocking state for connectivity.
        expect(within(internetRow).queryByText("Failed")).not.toBeInTheDocument();
        expect(within(internetRow).getByText(/slower than recommended/i)).toBeInTheDocument();

        const continueButton = within(internetRow).getByRole("button", { name: /continue anyway/i });
        await userEvent.click(continueButton);

        expect(ackSpy).toHaveBeenCalledWith(TOKEN);
        await waitFor(() => expect(within(internetRow).getByText(/continuing with a slow connection/i)).toBeInTheDocument());

        // Progress carries on past the warned step instead of stopping.
        await waitForRowState("microphone", "Passed");
        await waitForRowState("audio", "Passed");
        await waitFor(() => expect(screen.getByRole("button", { name: "Start Interview" })).toBeEnabled());
    });

    it("continuing past the connectivity advisory never blocks progress even if the acknowledgment call fails", async () => {
        vi.mocked(internetSpeedTest.testInternetSpeed).mockResolvedValue(speedResult({ passed: false }));
        server.use(
            http.post(`${API_BASE}/sessions/:token/connectivity_advisory`, () =>
                HttpResponse.json({ error: "boom" }, { status: 500 })
            )
        );

        render(<HardwareCheck token={TOKEN} />);

        const internetRow = await waitForRowState("internet", "Needs attention");
        await userEvent.click(within(internetRow).getByRole("button", { name: /continue anyway/i }));

        // Still lets the candidate through despite the backend call failing.
        await waitForRowState("microphone", "Passed");
        await waitFor(() => expect(screen.getByRole("button", { name: "Start Interview" })).toBeEnabled());
    });

    it("retrying the connectivity check re-tests speed independently of other steps", async () => {
        vi.mocked(internetSpeedTest.testInternetSpeed).mockResolvedValue(speedResult({ passed: false }));
        render(<HardwareCheck token={TOKEN} />);

        const internetRow = await waitForRowState("internet", "Needs attention");
        vi.mocked(internetSpeedTest.testInternetSpeed).mockResolvedValue(speedResult({ passed: true }));

        await userEvent.click(within(internetRow).getByTestId("retry-internet"));

        await waitFor(() => expect(within(internetRow).getByText("Passed")).toBeInTheDocument(), { timeout: 3000 });
        expect(internetSpeedTest.testInternetSpeed).toHaveBeenCalledTimes(2);
    });

    // F12: each real getUserMedia failure cause gets distinct copy.
    it("shows 'no microphone found' copy for NotFoundError", async () => {
        mockGetUserMedia(() => Promise.reject(new DOMException("no device", "NotFoundError")));
        render(<HardwareCheck token={TOKEN} />);

        const micRow = await waitForRowState("microphone", "Failed");
        expect(within(micRow).getByText(/no microphone found/i)).toBeInTheDocument();
    });

    it("shows 'permission denied' copy with Mac-specific recovery steps on MacOS", async () => {
        setPlatform("MacIntel");
        mockGetUserMedia(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
        render(<HardwareCheck token={TOKEN} />);

        const micRow = await waitForRowState("microphone", "Failed");
        expect(within(micRow).getByText(/microphone access denied/i)).toBeInTheDocument();
        expect(within(micRow).getByText(/system settings/i)).toBeInTheDocument();
    });

    it("shows 'permission denied' copy with Windows-specific recovery steps on Windows", async () => {
        setPlatform("Win32");
        mockGetUserMedia(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
        render(<HardwareCheck token={TOKEN} />);

        const micRow = await waitForRowState("microphone", "Failed");
        expect(within(micRow).getByText(/microphone access denied/i)).toBeInTheDocument();
        expect(within(micRow).getByText(/address bar/i)).toBeInTheDocument();
    });

    it("shows 'microphone in use' copy for NotReadableError, distinct from the other two causes", async () => {
        mockGetUserMedia(() => Promise.reject(new DOMException("busy", "NotReadableError")));
        render(<HardwareCheck token={TOKEN} />);

        const micRow = await waitForRowState("microphone", "Failed");
        expect(within(micRow).getByText(/microphone is in use/i)).toBeInTheDocument();
        expect(within(micRow).queryByText(/no microphone found/i)).not.toBeInTheDocument();
        expect(within(micRow).queryByText(/microphone access denied/i)).not.toBeInTheDocument();
    });

    // F35: each step is independently retryable.
    it("retrying the microphone step alone does not reset the already-passed internet step", async () => {
        mockGetUserMedia(() => Promise.reject(new DOMException("busy", "NotReadableError")));
        render(<HardwareCheck token={TOKEN} />);

        await waitForRowState("internet", "Passed");
        const micRow = await waitForRowState("microphone", "Failed");

        mockGetUserMedia(() => Promise.resolve(fakeStream()));
        await userEvent.click(within(micRow).getByTestId("retry-microphone"));

        await waitFor(() => expect(within(micRow).getByText("Passed")).toBeInTheDocument(), { timeout: 3000 });
        // Untouched by the microphone-only retry.
        await waitForRowState("internet", "Passed");
    });

    it("retrying the audio step alone re-runs its check after all steps have already passed", async () => {
        const constructed = vi.fn();
        class CountingAudioContext extends FakeAudioContext {
            constructor() {
                super();
                constructed();
            }
        }
        vi.stubGlobal("AudioContext", CountingAudioContext);

        render(<HardwareCheck token={TOKEN} />);
        await waitForRowState("audio", "Passed");
        // One AudioContext for mic-level monitoring (mic step) + one for the
        // audio-output tone check (audio step).
        const constructedBeforeRetry = constructed.mock.calls.length;

        const audioRow = screen.getByTestId("hardware-row-audio");
        await userEvent.click(within(audioRow).getByTestId("retry-audio"));

        // Re-runs the underlying check (a fresh AudioContext), settling back
        // to "Passed" rather than being a no-op.
        await waitFor(() => expect(constructed.mock.calls.length).toBeGreaterThan(constructedBeforeRetry));
        await waitFor(() => expect(within(audioRow).getByText("Passed")).toBeInTheDocument(), { timeout: 3000 });
    });

    // F35: progress feedback + a time estimate while checks are running.
    it("shows step-progress feedback and a time estimate while checks are still running", async () => {
        render(<HardwareCheck token={TOKEN} />);

        expect(await screen.findByText(/checking your setup/i)).toBeInTheDocument();
        expect(screen.getByText(/estimated time remaining/i)).toBeInTheDocument();

        await waitForRowState("audio", "Passed");
        // Once every step has settled, the progress banner goes away.
        await waitFor(() => expect(screen.queryByText(/checking your setup/i)).not.toBeInTheDocument());
    });

    it("localizes candidate-facing copy via useT when language=id", async () => {
        render(<HardwareCheck token={TOKEN} language="id" />);

        await waitForRowState("osAndBrowser", "Lulus");
        expect(screen.getByRole("button", { name: "Mulai Wawancara" })).toBeInTheDocument();
    });
});
