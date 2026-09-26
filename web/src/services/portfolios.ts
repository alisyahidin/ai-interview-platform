import api from "./api";
import type { Portfolio, AssessorOverride, FitGapReport } from "@/types";

export const portfoliosApi = {
  // portfolio_skills are a separate, own-id-addressed resource (out of
  // scope for #41) — untouched.
  getOverride: (portfolioSkillId: number, data: { override_level: number; assessor_notes: string }) =>
    api.post<{ override: AssessorOverride }>(`/portfolio_skills/${portfolioSkillId}/override`, {
      override: data,
    }),

  // Portfolios and vacancies are both public_id-addressed resources (#40/
  // #41) -- `vacancyId` here is a REQUEST param carrying the vacancy's
  // public_id string, matching what PortfolioPage's vacancy `<Select>`
  // offers and what PortfoliosController now resolves vacancies by.
  triggerFitGap: (portfolioPublicId: string, vacancyId: string) =>
    api.post<{ report: FitGapReport } | { status: string; message: string }>(
      `/portfolios/${portfolioPublicId}/fitgap`,
      { fitgap: { vacancy_id: vacancyId } }
    ),

  getFitGap: (portfolioPublicId: string, vacancyId: string) =>
    api.get<{ report: FitGapReport }>(`/portfolios/${portfolioPublicId}/fitgap/${vacancyId}`),

  regenerateFitGap: (portfolioPublicId: string, vacancyId: string) =>
    api.post<{ status: string; message: string }>(`/portfolios/${portfolioPublicId}/regenerate_fitgap`, {
      vacancy_id: vacancyId,
    }),

  exportPortfolio: (portfolioPublicId: string, format: "pdf" | "json", vacancyId?: string) =>
    api.get(`/portfolios/${portfolioPublicId}/export`, {
      params: { format, ...(vacancyId ? { vacancy_id: vacancyId } : {}) },
      responseType: format === "pdf" ? "blob" : "json",
    }),
};
