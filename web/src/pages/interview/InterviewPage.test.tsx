import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { axe } from "vitest-axe";
import { server } from "@/mocks/server";
import InterviewPage from "./InterviewPage";

// Proves the pre-hardware-check consent notice (F14/AC27, ticket #31):
// the candidate cannot reach `HardwareCheck` — and therefore microphone
// access is never attempted — without an explicit acknowledgment action,
// and acknowledging calls the ticket #29 consent endpoint. `HardwareCheck`'s
// own internals (mic/camera/internet steps) are out of scope here and
// covered by its own test file (ticket #30); it's stubbed below so this
// file only asserts what InterviewPage itself gates.
const API_BASE = "http://localhost:3001/api/v1";

vi.mock("@/components/HardwareCheck", () => ({
  default: ({ onStart }: { onStart?: () => void }) => (
    <div>
      <p>Hardware check stub</p>
      <button onClick={onStart}>Start Interview (stub)</button>
    </div>
  ),
}));

function renderPage(token = "tok-1") {
  return render(
    <MemoryRouter initialEntries={[`/interview/${token}`]}>
      <Routes>
        <Route path="/interview/:token" element={<InterviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const candidateInfo = {
  session_id: 1,
  role_title: "Backend Engineer",
  time_limit_min: 45,
  session_status: "pending",
  language: "en",
};

describe("InterviewPage consent notice (F14)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    server.use(
      http.get(`${API_BASE}/sessions/:token/candidate`, () =>
        HttpResponse.json({ data: candidateInfo })
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
    expect(consentSpy).toHaveBeenCalledWith("tok-1");
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
        HttpResponse.json({ data: { ...candidateInfo, language: "id" } })
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
