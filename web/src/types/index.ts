export interface Assessment {
  // Issue #40: assessments are addressed by `public_id` end to end -- the
  // sequential `id` is never sent by the backend for this resource type.
  public_id: string;
  name: string;
  time_limit_min: number;
  language?: "en" | "id";
  system_prompt?: string;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  skills?: AssessmentSkill[];
  latest_session?: {
    // #41: latest_session is a *session*, addressed by its public_id, not
    // the sequential id -- the backend no longer sends `id` here.
    public_id: string;
    status: "pending" | "active" | "ended";
    end_reason?: string | null;
    connectivity_advisory_acknowledged?: string | null;
  };
}

export interface AssessmentSkill {
  id?: number;
  skill_id?: number;
  skill_label: string;
  is_custom: boolean;
  expected_level: number;
  display_order: number;
  scope_include?: string;
  scope_exclude?: string;
  l1_anchor?: string;
  l2_anchor?: string;
  l3_anchor?: string;
  l4_anchor?: string;
  l5_anchor?: string;
  _destroy?: boolean;
}

export interface Session {
  // #41: sessions are addressed by public_id end-to-end; the backend no
  // longer sends the sequential id in session_json. The parent assessment
  // is one of the four public_id-covered resource types (#40), so its
  // sequential FK is never sent either -- only assessment_public_id is.
  public_id: string;
  assessment_public_id: string;
  tenant_id?: number;
  candidate_id?: number;
  candidate_name?: string;
  invite_token: string;
  invite_url: string;
  status: "pending" | "active" | "ended";
  end_reason?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  created_at?: string;
}

export interface CoverageSkill {
  id: number;
  skill_id: number;
  skill_label: string;
  is_discovered: boolean;
  state: "not_yet" | "initiated" | "partial" | "covered";
  probe_count: number;
  last_signal?: string;
  updated_at?: string;
}

export interface CoverageMap {
  skills: CoverageSkill[];
  discovered: CoverageSkill[];
  updated_at?: string;
}

export interface TranscriptTurn {
  id: number;
  turn_number: number;
  speaker: "candidate" | "ai" | "assessor" | "system";
  text: string;
  audio_start_ms?: number;
  audio_end_ms?: number;
  created_at: string;
}

// Machine-readable reason for a portfolio's `failed` generation, set by the
// backend's failure classifier (ticket #22). Named here so both the
// `Portfolio` type and any page-level copy lookup (e.g. `PortfolioPage`'s
// `FAILURE_COPY`) share one definition instead of redeclaring the union.
export type FailureCode = "upstream_error" | "invalid_output" | "timeout" | "unknown";

export interface Portfolio {
  // #41: portfolios are addressed by public_id end-to-end; the backend no
  // longer sends the sequential id (its own, or the parent session's) in
  // portfolio_json.
  public_id: string;
  session_public_id: string;
  candidate_id?: number;
  generation_status: "pending" | "generating" | "complete" | "failed";
  generated_at?: string;
  generation_error?: string;
  /**
   * `null`/`undefined` covers rows from before this column existed, or any
   * non-`failed` status — callers must treat that as "unknown reason" and
   * fall back to generic messaging rather than crashing (ticket #25).
   */
  failure_code?: FailureCode | null;
  skills: PortfolioSkill[];
  overrides: AssessorOverride[];
}

// Phase 3b (#23): the three mutually-exclusive base states a skill's
// judgment can be in, plus `needs_review` — which in the underlying data is
// its own `assessment_status` value, but always carries a real `ai_level`
// (see api/app/services/portfolios/level_normalizer.rb) and is presented as
// an orthogonal flag layered on top of the assessed/tentative base state,
// not a fourth visual state.
export type AssessmentStatus = "assessed" | "not_assessed" | "needs_review";

// Why a portfolio skill ended up `not_assessed`. `nil` covers the plain
// "the model returned no measurable level" case (distinct from omission).
export type StatusReason = "omitted_by_model" | "invalid_model_output" | null;

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PortfolioSkill {
  id: number;
  skill_id?: number | string;
  skill_label: string;
  is_discovered: boolean;
  // Nullable: `not_assessed` skills never have a level. `ai_level` may still
  // arrive as a "L3"-style string from older fixtures/tests; components
  // normalize via `parseLevel`.
  ai_level: number | string | null;
  ai_confidence: ConfidenceLevel;
  assessment_status: AssessmentStatus;
  status_reason?: StatusReason;
  evidence: string[];
  competency_summary: string;
}

export interface AssessorOverride {
  id: number;
  portfolio_skill_id: number;
  ai_level: number;
  override_level: number;
  assessor_notes: string;
  overridden_by?: number;
  overridden_at?: string;
}

export interface Vacancy {
  // Issue #40: vacancies are addressed by `public_id` end to end -- the
  // sequential `id` is never sent by the backend for this resource type.
  public_id: string;
  role_title: string;
  culture_dimensions: string;
  competency_expectations: string;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  skills: VacancySkill[];
}

export interface VacancySkill {
  id?: number;
  skill_id?: number;
  skill_label: string;
  expected_level: number;
  _destroy?: boolean;
}

export type SkillComparisonResult = "match" | "gap" | "exceed" | "not_assessed";

// `AssessmentStatus`/`ConfidenceLevel` are declared above, next to
// `PortfolioSkill` — reused here since the fit/gap row (#22) surfaces the
// same underlying enum values. `needs_review` behaves like `not_assessed`
// for comparison purposes today (see `FitGap::Engine#assessed?`) but is
// kept as its own value rather than collapsed, so the frontend never has to
// guess which case produced a given row.

export interface SkillComparison {
  skill_label: string;
  skill_id?: string;
  // The vacancy's required level for this skill. Was mis-typed/mis-read as
  // `required_level` — a key the backend has never sent (F8) — renamed to
  // match the actual `FitGap::Engine#build_skill_comparisons` response.
  expected_level: number;
  candidate_level?: number | null;
  result: SkillComparisonResult;
  delta?: number | null;
  confidence?: ConfidenceLevel | null;
  // Added by #22: whether an assessor override is applied on top of the AI
  // level, the AI's pre-override level, and the underlying skill's real
  // assessment status. All optional here because a backend that hasn't
  // shipped #22 yet simply omits them.
  is_override?: boolean;
  original_level?: number | null;
  assessment_status?: AssessmentStatus;
}

export interface FitGapReport {
  id: number;
  // Portfolios and vacancies are both public_id-covered resource types
  // (#40/#41) -- their raw sequential FKs are never sent, only public_id.
  portfolio_public_id: string;
  vacancy_public_id: string;
  skill_comparisons: SkillComparison[];
  culture_narrative: string;
  overall_narrative: string;
  generated_at: string;
}

export interface SkillTaxonomy {
  skill_id: string;
  skill_label: string;
  category: string;
  scope_include: string;
  scope_exclude: string;
  l1_anchor: string;
  l2_anchor: string;
  l3_anchor: string;
  l4_anchor: string;
  l5_anchor: string;
}

export interface CandidateInfo {
  session_id: number;
  role_title: string;
  time_limit_min: number;
  session_status: string;
  // Ticket #29: exposes the candidate-facing session's end reason. `string |
  // null` (not a literal union) to match the existing `Session.end_reason`
  // convention above rather than inventing a second enum type — the actual
  // backend values are `Session::END_REASONS` (manual_candidate |
  // manual_assessor | all_covered | time_ceiling | error), or `null` for a
  // session that hasn't ended yet.
  end_reason: string | null;
  // Ticket #29: the assessment's interview language, threaded down so
  // candidate-facing screens can drive `useT()` (ticket #28) with it — e.g.
  // the pre-hardware-check notice (ticket #31).
  language: "en" | "id";
}

export interface PaginationMeta {
  current_page: number;
  total_pages: number;
  total_count: number;
  per_page: number;
}

// WebSocket message types
export type InterviewState =
  | "idle"
  | "hardware_check"
  | "connecting"
  | "active"
  | "reconnecting"
  | "draining_audio"
  | "ending"
  | "complete"
  // Ticket #32 (F13): the candidate_info fetch's terminal failure modes,
  // distinct from `complete` and from each other — a malformed/unknown
  // token (404) is permanent and never retried, while any other failure
  // (network blip, 5xx) is transient and offers a retry. See
  // `InterviewPage`'s fetch effect.
  | "invalid_token"
  | "transient_error";

export type InterviewSpeaker = "ai" | "candidate" | null;

export interface WsControlMessage {
  type:
    | "session_started"
    | "session_ended"
    | "transcript"
    | "transcription"
    | "reconnecting"
    | "reconnected"
    | "speaker_changed"
    | "preparing_to_end"
    | "error";
  speaker?: "candidate" | "ai";
  role?: "candidate" | "ai";
  text?: string;
  reason?: string;
  code?: string;
  message?: string;
  recoverable?: boolean;
}

// Resource gate: the discriminated union every data-fetching hook resolves
// to, so `<Resource>` (see components/resource/) can render the matching
// presentation component for each case. A missing case is a type error
// instead of a silent blank screen.
//
// 401 is intentionally not a member here — an expired session is handled
// globally (see services/api.ts's response interceptor), not per-page.
export type ResourceState<T> =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; error: unknown }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "wrong-state"; data: T }
  | { status: "ready"; data: T };
