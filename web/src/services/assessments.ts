import api from "./api";
import type { Assessment, AssessmentSkill, PaginationMeta, Session } from "@/types";

export interface AssessmentPayload {
  name: string;
  time_limit_min: number;
  language?: "en" | "id";
  assessment_skills_attributes: Partial<AssessmentSkill>[];
}

export const assessmentsApi = {
  list: (page = 1) =>
    api.get<{ assessments: Assessment[]; meta: PaginationMeta }>("/assessments", {
      params: { page },
    }),

  get: (publicId: string) =>
    api.get<{ assessment: Assessment }>(`/assessments/${publicId}`),

  create: (data: AssessmentPayload) =>
    api.post<{ assessment: Assessment; system_prompt_generated: boolean }>(
      "/assessments",
      { assessment: data }
    ),

  update: (publicId: string, data: AssessmentPayload) =>
    api.put<{ assessment: Assessment; system_prompt_generated: boolean }>(
      `/assessments/${publicId}`,
      { assessment: data }
    ),

  delete: (publicId: string) => api.delete(`/assessments/${publicId}`),

  getSessions: (assessmentPublicId: string) =>
    api.get<{ sessions: Session[] }>(`/assessments/${assessmentPublicId}/sessions`),

  createSession: (assessmentPublicId: string, candidateName?: string, candidateId?: number) =>
    api.post<{ session: Session; invite_url: string }>(
      `/assessments/${assessmentPublicId}/sessions`,
      { session: { candidate_name: candidateName, candidate_id: candidateId } }
    ),
};
