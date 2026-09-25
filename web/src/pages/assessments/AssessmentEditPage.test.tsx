import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import AssessmentEditPage from "./AssessmentEditPage";

// Ticket #17: AssessmentEditPage used to swallow a 404 on fetch
// (`.catch(() => {})`) and render a blank, fully-submittable form as if
// creating a new record. These tests prove it's now wired through
// `<Resource>`/`useResource` (#13): a 404 renders `<NotFoundState>` instead
// of a form, and an existing record still renders the form correctly.
const API_BASE = "http://localhost:3001/api/v1";

function renderPage(id = "1") {
  return render(
    <MemoryRouter initialEntries={[`/assessments/${id}/edit`]}>
      <Routes>
        <Route path="/assessments/:id/edit" element={<AssessmentEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AssessmentEditPage not-found handling", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("renders <NotFoundState> with a back-to-assessments-list target for a non-existent assessment, not a form", async () => {
    server.use(
      http.get(`${API_BASE}/assessments/999`, () =>
        HttpResponse.json({ errors: [{ message: "not found" }] }, { status: 404 })
      )
    );

    renderPage("999");

    await waitFor(() => expect(screen.getByText(/assessment not found/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /back to assessments/i })).toHaveAttribute(
      "href",
      "/assessments"
    );

    // No form should be rendered — no silent swallow into a blank submittable form.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });

  it("renders the edit form populated with the existing record when it does exist", async () => {
    server.use(
      http.get(`${API_BASE}/assessments/1`, () =>
        HttpResponse.json({
          data: {
            assessment: {
              id: 1,
              name: "Backend Engineer",
              time_limit_min: 45,
              skills: [
                {
                  id: 1,
                  skill_label: "SQL",
                  is_custom: false,
                  expected_level: 3,
                  display_order: 0,
                },
              ],
            },
          },
        })
      )
    );

    renderPage("1");

    await waitFor(() =>
      expect(screen.getByDisplayValue("Backend Engineer")).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByText(/assessment not found/i)).not.toBeInTheDocument();
  });
});
