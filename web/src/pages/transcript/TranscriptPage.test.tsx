import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import TranscriptPage from "./TranscriptPage";

// Proves TranscriptPage is wired to <Resource> (ticket #18): a pending/failed
// session with nothing recorded yet renders the guarded "wrong-state"
// explanation instead of an empty-state message indistinguishable from any
// other empty case (AC16), and existing ready-state rendering is unchanged.
// Does not re-derive <Resource>'s own matrix (see Resource.test.tsx).
const API_BASE = "http://localhost:3001/api/v1";
// #41: sessions are addressed by public_id, not a sequential id.
const SESSION_PUBLIC_ID = "session-public-1";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/assessments/1/sessions/${SESSION_PUBLIC_ID}/transcript`]}>
      <Routes>
        <Route path="/assessments/:id/sessions/:sessionId/transcript" element={<TranscriptPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function mockSession(session: Record<string, unknown>) {
  server.use(
    http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}`, () =>
      HttpResponse.json({
        data: {
          session: {
            public_id: SESSION_PUBLIC_ID,
            assessment_public_id: "assessment-public-1",
            invite_token: "tok",
            invite_url: "https://x/tok",
            candidate_name: "Ali",
            ...session,
          },
          assessment: { id: 1, name: "Backend Engineer", time_limit_min: 45 },
        },
      })
    )
  );
}

const readyTurns = [
  { id: 1, turn_number: 1, speaker: "ai", text: "Tell me about your experience.", created_at: "2024-01-01T00:00:00Z" },
  { id: 2, turn_number: 2, speaker: "candidate", text: "I have five years of experience.", created_at: "2024-01-01T00:01:00Z" },
];

describe("TranscriptPage", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/transcript`, () =>
        HttpResponse.json({ data: { turns: readyTurns, total: readyTurns.length } })
      )
    );
  });

  it("renders a guarded wrong-state explanation with a route back for a pending session", async () => {
    mockSession({ status: "pending" });

    renderPage();

    expect(await screen.findByText(/interview hasn't started yet/i)).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to sessions/i });
    expect(backLink).toHaveAttribute("href", "/assessments/1/invite");
    // The wrong-state page never fetches transcript content.
    expect(screen.queryByText("Interview Transcript")).not.toBeInTheDocument();
    expect(screen.queryByText(/no transcript available/i)).not.toBeInTheDocument();
  });

  it("renders a guarded wrong-state explanation with a route back for a failed session", async () => {
    mockSession({ status: "ended", end_reason: "error" });

    renderPage();

    expect(await screen.findByText(/interview didn't complete/i)).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to sessions/i });
    expect(backLink).toHaveAttribute("href", "/assessments/1/invite");
    expect(screen.queryByText("Interview Transcript")).not.toBeInTheDocument();
  });

  it("renders the existing ready-state transcript content for a completed session", async () => {
    mockSession({ status: "ended", end_reason: "completed" });

    renderPage();

    expect(await screen.findByText("Interview Transcript")).toBeInTheDocument();
    expect(screen.getByText("Ali")).toBeInTheDocument();
    expect(await screen.findByText("Tell me about your experience.")).toBeInTheDocument();
    expect(screen.getByText("I have five years of experience.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download \.txt/i })).toBeInTheDocument();
  });

  it("still renders the generic empty state (not wrong-state) for an active session with no turns yet", async () => {
    mockSession({ status: "active" });
    server.use(
      http.get(`${API_BASE}/sessions/${SESSION_PUBLIC_ID}/transcript`, () =>
        HttpResponse.json({ data: { turns: [], total: 0 } })
      )
    );

    renderPage();

    expect(await screen.findByText(/no transcript available for this session/i)).toBeInTheDocument();
    expect(screen.queryByText(/interview hasn't started yet/i)).not.toBeInTheDocument();
  });
});
