export interface Assessment {
  id: number;
  name: string;
  time_limit_min: number;
  language?: "en" | "id";
  system_prompt?: string;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  skills?: AssessmentSkill[];
  latest_session?: {
    status: "pending" | "active" | "ended";
    end_reason?: string | null;
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
  id: number;
  assessment_id: number;
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

export interface Portfolio {
  id: number;
  session_id: number;
  candidate_id?: number;
  generation_status: "pending" | "generating" | "complete" | "failed";
  generated_at?: string;
  generation_error?: string;
  skills: PortfolioSkill[];
  overrides: AssessorOverride[];
}

export interface PortfolioSkill {
  id: number;
  skill_id?: number;
  skill_label: string;
  is_discovered: boolean;
  ai_level: string;       // "L1" | "L2" | "L3" | "L4" | "L5"
  ai_confidence: string;  // "high" | "medium" | "low"
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
  id: number;
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

// Mirrors `portfolio_skills.assessment_status` (PR2) as surfaced per fit/gap
// row by #22. `needs_review` behaves like `not_assessed` for comparison
// purposes today (see `FitGap::Engine#assessed?`) but is kept as its own
// value rather than collapsed, so the frontend never has to guess which case
// produced a given row.
export type AssessmentStatus = "assessed" | "not_assessed" | "needs_review";

export type ConfidenceLevel = "high" | "medium" | "low";

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
  portfolio_id: number;
  vacancy_id: number;
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
  | "complete";

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
