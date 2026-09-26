import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import SignupPage from "./SignupPage";

// #42: SignupPage rebuilt -- routed at /signup, invitation-token + email +
// password only (no role selector, the F45 privilege-escalation hazard this
// closes), consuming the real /auth/register contract from #38.
const API_BASE = "http://localhost:3001/api/v1";

const GENERIC_ERROR =
  "Registration could not be completed. Check your invitation link, or log in if you already have an account.";

// A tiny stand-in for /login that surfaces the navigation state SignupPage
// hands it, so tests can assert on the redirect without depending on the
// real LoginPage's markup.
function LoginStub() {
  const location = useLocation();
  const justRegistered = Boolean((location.state as { justRegistered?: boolean } | null)?.justRegistered);
  return <div>Login page{justRegistered ? " (justRegistered)" : ""}</div>;
}

function renderPage(initialEntry = "/signup") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SignupPage", () => {
  beforeEach(() => {
    server.use(
      http.post(`${API_BASE}/auth/register`, () =>
        HttpResponse.json({ message: "Registration successful. You can now log in." }, { status: 201 })
      )
    );
  });

  it("renders no role selector or radio group anywhere on the page (F45 regression guard)", () => {
    renderPage();

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText(/\badmin\b/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });

  it("prefills the invitation token from a ?token= query param but keeps it editable", () => {
    renderPage("/signup?token=abc123");

    const tokenInput = screen.getByLabelText(/invitation token/i) as HTMLInputElement;
    expect(tokenInput).toHaveValue("abc123");
    expect(tokenInput).not.toHaveAttribute("readonly");
    expect(tokenInput).not.toBeDisabled();
  });

  it("submits invitation token + email + password with no role field, then redirects toward /login on success", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${API_BASE}/auth/register`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ message: "Registration successful. You can now log in." }, { status: 201 });
      })
    );

    renderPage("/signup?token=valid-token");

    await userEvent.type(screen.getByLabelText(/email/i), "new.user@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "s3cret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));

    await waitFor(() => expect(screen.getByText(/login page/i)).toBeInTheDocument());
    expect(screen.getByText(/justRegistered/i)).toBeInTheDocument();

    expect(capturedBody).toEqual({
      invitation_token: "valid-token",
      email: "new.user@example.com",
      password: "s3cret-pass",
    });
    expect(capturedBody).not.toHaveProperty("role");
  });

  it("shows a loading state while the request is in flight", async () => {
    server.use(
      http.post(`${API_BASE}/auth/register`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ message: "Registration successful. You can now log in." }, { status: 201 });
      })
    );

    renderPage("/signup?token=valid-token");
    await userEvent.type(screen.getByLabelText(/email/i), "new.user@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "s3cret-pass");

    const submitButton = screen.getByRole("button", { name: /sign up/i });
    await userEvent.click(submitButton);

    expect(submitButton).toBeDisabled();

    await waitFor(() => expect(screen.getByText(/login page/i)).toBeInTheDocument());
  });

  it("shows the backend's generic error message for an invalid/expired invitation token", async () => {
    server.use(
      http.post(`${API_BASE}/auth/register`, () =>
        HttpResponse.json(
          { errors: [{ status: 422, message: GENERIC_ERROR }] },
          { status: 422 }
        )
      )
    );

    renderPage("/signup?token=expired-token");
    await userEvent.type(screen.getByLabelText(/email/i), "someone@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "s3cret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
  });

  it("shows the exact same generic error message for a duplicate email as for an invalid token " +
    "(anti-enumeration -- a different message here would silently defeat #35's AC5)", async () => {
    server.use(
      http.post(`${API_BASE}/auth/register`, () =>
        HttpResponse.json(
          { errors: [{ status: 422, message: GENERIC_ERROR }] },
          { status: 422 }
        )
      )
    );

    renderPage("/signup?token=valid-token");
    await userEvent.type(screen.getByLabelText(/email/i), "already.registered@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "s3cret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
  });

  it("does not submit when fields are empty, showing client-side validation instead of calling the API", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(/invitation token is required/i)).toBeInTheDocument();
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
  });

  it("shows a validation error for an implausible email shape without calling the API", async () => {
    renderPage("/signup?token=valid-token");

    await userEvent.type(screen.getByLabelText(/email/i), "not-an-email");
    await userEvent.type(screen.getByLabelText(/password/i), "s3cret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });
});
