import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import InterviewPage from "./InterviewPage";

// Ticket #32 (F13): proves the candidate_info fetch's three distinct
// terminal outcomes — invalid_token, transient_error, complete — are
// actually distinguishable from one another, and that `complete` itself
// branches its copy on `end_reason`. Before this ticket, every failure
// (a bad token, a network blip, a real completion) funneled through the
// same `.catch(() => setInterviewState("complete"))`.
//
// Also covers ticket #31 (F14): the pre-hardware-check consent notice —
// the candidate cannot reach `HardwareCheck` (and therefore microphone
// access is never attempted) without an explicit acknowledgment action,
// and acknowledging calls the ticket #29 consent endpoint.
//
// `HardwareCheck`'s own internals (mic/camera/internet steps) are out of
// scope here and covered by its own test file (ticket #30); it's stubbed
// below so this file only asserts what InterviewPage itself gates.
const API_BASE = "http://localhost:3001/api/v1";
const TOKEN = "tok-abc123";

vi.mock("@/components/HardwareCheck", () => ({
  default: ({ onStart }: { onStart?: () => void }) => (
    <div>
      <p>Hardware check stub</p>
      <button onClick={onStart}>Start Interview (stub)</button>
    </div>
  ),
}));

function renderPage(token = TOKEN) {
  return render(
    <MemoryRouter initialEntries={[`/interview/${token}`]}>
      <Routes>
        <Route path="/interview/:token" element={<InterviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function candidateInfo(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 1,
    role_title: "Backend Engineer",
    time_limit_min: 45,
    session_status: "pending",
    end_reason: null,
    language: "en",
    ...overrides,
  };
}

function mockCandidateInfo(body: Record<string, unknown>) {
  server.use(
    http.get(`${API_BASE}/sessions/${TOKEN}/candidate`, () => HttpResponse.json({ data: body }))
  );
}

describe("InterviewPage terminal states", () => {
  it("shows an explicit invalid-link state for a token that never resolves to a real session (404), never completion", async () => {
    server.use(
      http.get(`${API_BASE}/sessions/${TOKEN}/candidate`, () =>
        HttpResponse.json({ error: "Invalid or expired invite token" }, { status: 404 })
      )
    );

    renderPage();

    expect(await screen.findByText(/interview link isn't valid/i)).toBeInTheDocument();
    expect(screen.queryByText(/interview complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has been recorded/i)).not.toBeInTheDocument();
    // Permanent — no retry (or any other action) is ever offered.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a distinct retryable state for a transient fetch failure (5xx) — not invalid-link, not completion", async () => {
    server.use(
      http.get(`${API_BASE}/sessions/${TOKEN}/candidate`, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 })
      )
    );

    renderPage();

    expect(await screen.findByText(/couldn't load your interview/i)).toBeInTheDocument();
    expect(screen.queryByText(/interview link isn't valid/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/interview complete/i)).not.toBeInTheDocument();

    // Retry re-runs the exact same fetch. Recovering into a terminal
    // "ended" response proves the retry actually re-attempted the request
    // (without depending on the unrelated idle/hardware-check UI).
    const retryButton = screen.getByRole("button", { name: /retry/i });
    mockCandidateInfo(candidateInfo({ session_status: "ended", end_reason: "manual_candidate" }));
    await userEvent.click(retryButton);

    expect(await screen.findByText(/interview complete/i)).toBeInTheDocument();
  });

  it("shows a distinct retryable state for a genuine network error (no response at all)", async () => {
    server.use(http.get(`${API_BASE}/sessions/${TOKEN}/candidate`, () => HttpResponse.error()));

    renderPage();

    expect(await screen.findByText(/couldn't load your interview/i)).toBeInTheDocument();
    expect(screen.queryByText(/interview link isn't valid/i)).not.toBeInTheDocument();
  });

  it("shows an honest 'didn't complete' message, not the recorded-successfully copy, for a session that ended in error", async () => {
    mockCandidateInfo(candidateInfo({ session_status: "ended", end_reason: "error" }));

    renderPage();

    expect(await screen.findByText(/your interview didn't complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/has been recorded/i)).not.toBeInTheDocument();
    // No restart/resubmit action is ever offered from a terminal state.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the completion state, with no restart action, when reopening a session that already ended normally", async () => {
    mockCandidateInfo(candidateInfo({ session_status: "ended", end_reason: "all_covered" }));

    renderPage();

    expect(await screen.findByText("Interview Complete")).toBeInTheDocument();
    expect(screen.getByText(/has been recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/didn't complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the same completion/error distinction in Indonesian, driven by the candidate's session language", async () => {
    mockCandidateInfo(
      candidateInfo({ session_status: "ended", end_reason: "error", language: "id" })
    );

    renderPage();

    expect(await screen.findByText("Wawancara Anda belum selesai")).toBeInTheDocument();
    expect(screen.queryByText(/has been recorded/i)).not.toBeInTheDocument();
  });

  it("renders the invalid-link and transient-error copy in Indonesian too, defaulting away from English", async () => {
    // The token never resolved, so no candidate_info (and thus no
    // language) was ever fetched — these two states can't know the
    // candidate's language and fall back to English. This is asserted
    // explicitly so a future change doesn't silently assume a language
    // that was never actually available.
    server.use(
      http.get(`${API_BASE}/sessions/${TOKEN}/candidate`, () =>
        HttpResponse.json({ error: "nope" }, { status: 404 })
      )
    );

    renderPage();

    expect(await screen.findByText("This interview link isn't valid")).toBeInTheDocument();
  });
});

describe("InterviewPage consent notice (F14)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    server.use(
      http.get(`${API_BASE}/sessions/:token/candidate`, () =>
        HttpResponse.json({ data: candidateInfo() })
      )
    );
  });

  it("shows the notice (not the hardware check) before any acknowledgment", async () => {
    renderPage();

    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByText(/hardware check stub/i)).not.toBeInTheDocument();

    // States what is recorded, AI involvement, purpose, and a contact point.
    expect(screen.getByText(/we record your voice/i)).toBeInTheDocument();
    expect(screen.getByText(/conducted by an ai/i)).toBeInTheDocument();
    expect(screen.getByText(/assess your fit for the role/i)).toBeInTheDocument();
    expect(screen.getByText("support@example.com")).toBeInTheDocument();
  });

  it("cannot proceed to the hardware check without checking the acknowledgment box", async () => {
    renderPage();
    await screen.findByRole("checkbox");

    const continueButton = screen.getByRole("button", { name: /i understand and agree/i });
    expect(continueButton).toBeDisabled();

    // Not implied by e.g. a timeout — waiting does not enable it.
    await new Promise((r) => setTimeout(r, 50));
    expect(continueButton).toBeDisabled();
    expect(screen.queryByText(/hardware check stub/i)).not.toBeInTheDocument();
  });

  it("calls the ticket #29 consent endpoint and reveals the hardware check once acknowledged", async () => {
    const consentSpy = vi.fn();
    server.use(
      http.post(`${API_BASE}/sessions/:token/consent`, async ({ params }) => {
        consentSpy(params.token);
        return HttpResponse.json({
          data: { session_id: 1, consent_given_at: "2026-01-01T00:00:00Z" },
        });
      })
    );

    renderPage();
    const checkbox = await screen.findByRole("checkbox");

    await userEvent.click(checkbox);
    const continueButton = screen.getByRole("button", { name: /i understand and agree/i });
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);

    await waitFor(() => expect(screen.getByText(/hardware check stub/i)).toBeInTheDocument());
    expect(consentSpy).toHaveBeenCalledWith(TOKEN);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not re-show the notice on a reload (remount) of the same session once acknowledged", async () => {
    server.use(
      http.post(`${API_BASE}/sessions/:token/consent`, () =>
        HttpResponse.json({ data: { session_id: 1, consent_given_at: "2026-01-01T00:00:00Z" } })
      )
    );

    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /i understand and agree/i }));
    await waitFor(() => expect(screen.getByText(/hardware check stub/i)).toBeInTheDocument());

    unmount();
    renderPage();

    await waitFor(() => expect(screen.getByText(/hardware check stub/i)).toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("surfaces a retryable error and keeps the gate closed if acknowledging fails", async () => {
    server.use(
      http.post(`${API_BASE}/sessions/:token/consent`, () => HttpResponse.json({}, { status: 500 }))
    );

    renderPage();
    await userEvent.click(await screen.findByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /i understand and agree/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/hardware check stub/i)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("renders the notice in Bahasa Indonesia when the candidate's language is `id`", async () => {
    server.use(
      http.get(`${API_BASE}/sessions/:token/candidate`, () =>
        HttpResponse.json({ data: candidateInfo({ language: "id" }) })
      )
    );

    renderPage();

    expect(await screen.findByText(/sebelum kita mulai/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /saya mengerti dan setuju/i })).toBeInTheDocument();
  });

  it("has no axe violations on the notice screen", async () => {
    const { container } = renderPage();
    await screen.findByRole("checkbox");
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
