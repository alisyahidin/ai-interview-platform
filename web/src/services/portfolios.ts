import api from "./api";
import type { Portfolio, AssessorOverride, FitGapReport } from "@/types";

export const portfoliosApi = {
  // portfolio_skills are a separate, own-id-addressed resource (out of
  // scope for #41) — untouched.
  getOverride: (portfolioSkillId: number, data: { override_level: number; assessor_notes: string }) =>
    api.post<{ override: AssessorOverride }>(`/portfolio_skills/${portfolioSkillId}/override`, {
      override: data,
    }),

  // #41: portfolios are addressed by public_id (a string), not the
  // sequential id. vacancyId stays a number — vacancies are out of scope
  // for this ticket (#40).
  triggerFitGap: (portfolioPublicId: string, vacancyId: number) =>
    api.post<{ report: FitGapReport } | { status: string; message: string }>(
      `/portfolios/${portfolioPublicId}/fitgap`,
      { fitgap: { vacancy_id: vacancyId } }
    ),

  getFitGap: (portfolioPublicId: string, vacancyId: number) =>
    api.get<{ report: FitGapReport }>(`/portfolios/${portfolioPublicId}/fitgap/${vacancyId}`),

  regenerateFitGap: (portfolioPublicId: string, vacancyId: number) =>
    api.post<{ status: string; message: string }>(`/portfolios/${portfolioPublicId}/regenerate_fitgap`, {
      vacancy_id: vacancyId,
    }),

  exportPortfolio: (portfolioPublicId: string, format: "pdf" | "json", vacancyId?: number) =>
    api.get(`/portfolios/${portfolioPublicId}/export`, {
      params: { format, ...(vacancyId ? { vacancy_id: vacancyId } : {}) },
      responseType: format === "pdf" ? "blob" : "json",
    }),
};
