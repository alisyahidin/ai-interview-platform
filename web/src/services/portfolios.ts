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
  // sequential id. `vacancyId` here is a REQUEST param, not a response
  // field -- revisited during the FK-leak review that fixed fit_gap_json's
  // response shape (portfolio_id/vacancy_id -> portfolio_public_id/
  // vacancy_public_id below). The backend's fitgap/regenerate_fitgap/
  // show_fitgap/export actions still look FitGapReport/Vacancy up by the
  // raw sequential vacancy id here (see PortfoliosController), so this
  // still intentionally stays a number for now -- vacancies are out of
  // scope for #41. NB: this exposes a separate, real seam (not part of
  // #41's fix): `Vacancy` responses never carry a raw id (#40), so nothing
  // in this app can legitimately obtain the number this param wants --
  // see PortfolioPage's vacancy `<Select>`, which passes `v.public_id`
  // through `Number(...)` here today.
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
