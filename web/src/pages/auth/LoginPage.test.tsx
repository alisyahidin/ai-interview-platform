import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { clearToken, getStoredToken } from "@/stores/authAtom";
import LoginPage from "./LoginPage";

// #43: LoginPage states who it's for (internal assessors/staff) and proves,
// end-to-end from the UI, that #39's fix actually works -- both `admin` and
// `user` role accounts can reach a working, authenticated state through this
// form, not just through the API directly.
const API_BASE = "http://localhost:3001/api/v1";

// A tiny stand-in for the post-login destination (/assessments) so tests can
// assert on the redirect without depending on that page's own markup/data.
function AssessmentsStub() {
  return <div>Assessments page</div>;
}

function renderPage(initialEntry: { pathname: string; state?: unknown } | string = "/login") {
  const entry = typeof initialEntry === "string" ? { pathname: initialEntry } : initialEntry;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/assessments" element={<AssessmentsStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    clearToken();
  });

  it("states plainly that this sign-in is for internal assessors/staff, and points candidates to their emailed invite link", () => {
    renderPage();

    expect(screen.getByText(/for internal assessors and staff/i)).toBeInTheDocument();
    expect(screen.getByText(/candidates.*use the interview link emailed/i)).toBeInTheDocument();
  });

  it("logs in a role: \"user\" account successfully (regression guard -- this was previously impossible, see #39)", async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, async ({ request }) => {
        const body = (await request.json()) as { email: string; password: string };
        expect(body).toEqual({ email: "assessor@example.com", password: "correct-horse" });
        return HttpResponse.json({
          token: "user-role-token",
          user: { id: 2, email: "assessor@example.com", role: "user", organization_id: 7 },
        });
      })
    );

    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), "assessor@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText(/assessments page/i)).toBeInTheDocument());
    expect(getStoredToken()).toBe("user-role-token");
  });

  it("logs in a role: \"admin\" account successfully", async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, () =>
        HttpResponse.json({
          token: "admin-role-token",
          user: { id: 1, email: "admin@example.com", role: "admin", organization_id: 7 },
        })
      )
    );

    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText(/assessments page/i)).toBeInTheDocument());
    expect(getStoredToken()).toBe("admin-role-token");
  });

  it("shows the backend's error message for a wrong password / unknown email (401)", async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, () =>
        HttpResponse.json(
          { errors: [{ status: 401, message: "Invalid email or password" }] },
          { status: 401 }
        )
      )
    );

    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), "nobody@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();
  });

  it("falls back to a generic error message if the 401 response carries none", async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, () => new HttpResponse(null, { status: 401 }))
    );

    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), "nobody@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it("blocks the request client-side when email/password are empty", async () => {
    let requestMade = false;
    server.use(
      http.post(`${API_BASE}/auth/login`, () => {
        requestMade = true;
        return HttpResponse.json({ token: "t", user: { id: 1, email: "a@b.com", role: "admin", organization_id: 1 } });
      })
    );

    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/enter both your email and password/i)).toBeInTheDocument();
    expect(requestMade).toBe(false);
  });

  it("shows a loading state that disables the submit button while the request is in flight", async () => {
    server.use(
      http.post(`${API_BASE}/auth/login`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          token: "t",
          user: { id: 1, email: "admin@example.com", role: "admin", organization_id: 1 },
        });
      })
    );

    renderPage();

    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "correct-horse");

    const submitButton = screen.getByRole("button", { name: /sign in/i });
    await userEvent.click(submitButton);

    expect(submitButton).toBeDisabled();

    await waitFor(() => expect(screen.getByText(/assessments page/i)).toBeInTheDocument());
  });

  it("shows the justRegistered banner from #42 when navigated here with that state", () => {
    renderPage({ pathname: "/login", state: { justRegistered: true } });

    expect(screen.getByText(/account created\. please sign in\./i)).toBeInTheDocument();
  });

  it("does not show the justRegistered banner on a normal visit", () => {
    renderPage();

    expect(screen.queryByText(/account created/i)).not.toBeInTheDocument();
  });
});
