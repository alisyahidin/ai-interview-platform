import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import VacancyEditPage from "./VacancyEditPage";

// Ticket #17: VacancyEditPage had the identical bug as AssessmentEditPage —
// a swallowed 404 (`.catch(() => {})`) rendering a blank, fully-submittable
// form. These tests prove it's now wired through `<Resource>`/`useResource`
// (#13): a 404 renders `<NotFoundState>` instead of a form, and an existing
// record still renders the form correctly.
const API_BASE = "http://localhost:3001/api/v1";

function renderPage(id = "1") {
  return render(
    <MemoryRouter initialEntries={[`/vacancies/${id}/edit`]}>
      <Routes>
        <Route path="/vacancies/:id/edit" element={<VacancyEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("VacancyEditPage not-found handling", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("renders <NotFoundState> with a back-to-vacancies-list target for a non-existent vacancy, not a form", async () => {
    server.use(
      http.get(`${API_BASE}/vacancies/999`, () =>
        HttpResponse.json({ errors: [{ message: "not found" }] }, { status: 404 })
      )
    );

    renderPage("999");

    await waitFor(() => expect(screen.getByText(/vacancy not found/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /back to vacancies/i })).toHaveAttribute(
      "href",
      "/vacancies"
    );

    // No form should be rendered — no silent swallow into a blank submittable form.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });

  it("renders the edit form populated with the existing record when it does exist", async () => {
    server.use(
      http.get(`${API_BASE}/vacancies/1`, () =>
        HttpResponse.json({
          data: {
            vacancy: {
              id: 1,
              role_title: "Senior Backend Engineer",
              culture_dimensions: "Ownership",
              competency_expectations: "Strong SQL",
              skills: [
                { id: 1, skill_id: 1, skill_label: "SQL", expected_level: 3 },
              ],
            },
          },
        })
      )
    );

    renderPage("1");

    await waitFor(() =>
      expect(screen.getByDisplayValue("Senior Backend Engineer")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByText(/vacancy not found/i)).not.toBeInTheDocument();
  });
});
