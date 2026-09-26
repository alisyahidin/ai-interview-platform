import api from "./api";
import type { Session, CoverageMap, TranscriptTurn, Portfolio, CandidateInfo } from "@/types";

export const sessionsApi = {
  get: (id: number) =>
    api.get<{ session: Session; assessment: { id: number; name: string; time_limit_min: number } }>(
      `/sessions/${id}`
    ),

  endSession: (id: number, reason = "manual_assessor") =>
    api.post<{ session: Session }>(`/sessions/${id}/end_session`, {
      session: { reason },
    }),

  getCoverage: (id: number) =>
    api.get<CoverageMap>(`/sessions/${id}/coverage`),

  getTranscript: (id: number, fromTurn?: number) =>
    api.get<{ turns: TranscriptTurn[]; total: number }>(`/sessions/${id}/transcript`, {
      params: fromTurn ? { from_turn: fromTurn } : undefined,
    }),

  getPortfolio: (id: number) =>
    api.get<{ portfolio: Portfolio } | { status: string }>(`/sessions/${id}/portfolio`),

  regeneratePortfolio: (id: number) =>
    api.post<{ message: string; portfolio: Portfolio }>(`/sessions/${id}/portfolio/regenerate`),

  getCandidateInfo: (token: string) =>
    api.get<CandidateInfo>(`/sessions/${token}/candidate`),

  audioComplete: (token: string) =>
    api.post<{ ended: boolean; message: string }>(`/sessions/${token}/audio_complete`),

  // Assessor-authenticated. Issues a brand-new session + invite token for the
  // same candidate/assessment when the target session is in a terminal failed
  // state (status: "ended", end_reason: "error" — see Session#failed? on the
  // backend). The original failed session is left completely unmodified.
  reinvite: (id: number) =>
    api.post<{ session: Session; invite_url: string }>(`/sessions/${id}/reinvite`),

  // Ticket #29: acknowledges the pre-interview notice (F14/AC27), setting
  // `consent_given_at` on the session. No JWT — the invite token in the URL
  // is the auth, matching `getCandidateInfo`/`audioComplete` above.
  acknowledgeConsent: (token: string) =>
    api.post<{ session_id: number; consent_given_at: string }>(`/sessions/${token}/consent`),

  // Ticket #30 (F10/D4): records that the candidate chose "Continue anyway"
  // past a connectivity advisory warning, setting
  // `connectivity_advisory_acknowledged` on the session so the assessor can
  // see the context later. No JWT — invite token in the URL, matching the
  // other candidate-facing methods above. This never gates progress itself;
  // callers must not block continuing the hardware check on this call
  // succeeding (see HardwareCheck.tsx).
  acknowledgeConnectivityAdvisory: (token: string) =>
    api.post<{ session_id: number; connectivity_advisory_acknowledged: string | null }>(
      `/sessions/${token}/connectivity_advisory`
    ),
};
