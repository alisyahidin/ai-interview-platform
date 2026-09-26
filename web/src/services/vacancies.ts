import api from "./api";
import type { Vacancy, VacancySkill, PaginationMeta } from "@/types";

export interface VacancyPayload {
  role_title: string;
  culture_dimensions: string;
  competency_expectations: string;
  vacancy_skills_attributes: Partial<VacancySkill>[];
}

export const vacanciesApi = {
  list: (page = 1) =>
    api.get<{ vacancies: Vacancy[]; meta: PaginationMeta }>("/vacancies", {
      params: { page },
    }),

  get: (publicId: string) =>
    api.get<{ vacancy: Vacancy }>(`/vacancies/${publicId}`),

  create: (data: VacancyPayload) =>
    api.post<{ vacancy: Vacancy }>("/vacancies", { vacancy: data }),

  update: (publicId: string, data: VacancyPayload) =>
    api.put<{ vacancy: Vacancy }>(`/vacancies/${publicId}`, { vacancy: data }),

  delete: (publicId: string) => api.delete(`/vacancies/${publicId}`),
};
