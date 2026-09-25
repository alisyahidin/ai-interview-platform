import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import App from "./App";
import { authAtom } from "@/stores/authAtom";

// Ticket #14 (F24): there was no catch-all route, so an unknown URL rendered
// nothing inside the layout. This proves the routing wiring end to end —
// <Resource>/<NotFoundState>'s own presentation is covered by their own
// component tests, this just proves the unmatched path actually reaches it.
//
// Code review fix: the catch-all route must be nested inside the same
// <ProtectedRoute> as every other assessor route, so an unauthenticated
// visitor is redirected to /login instead of seeing the fully authenticated
// app chrome for an unmatched URL.
function HydrateAuth({ token, children }: { token: string | null; children: React.ReactNode }) {
  useHydrateAtoms([[authAtom, { token }]]);
  return <>{children}</>;
}

function renderApp(path: string, token: string | null) {
  return render(
    <JotaiProvider>
      <HydrateAuth token={token}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </HydrateAuth>
    </JotaiProvider>
  );
}

describe("App routing — catch-all 404", () => {
  it("renders <NotFoundState> content inside the layout for an authenticated user on an unmatched path", () => {
    renderApp("/this/route/does/not/exist", "test-token");

    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to assessments/i })).toHaveAttribute(
      "href",
      "/assessments"
    );

    // The layout chrome (AssessorLayout's header/nav) stays present around
    // the 404 content — this isn't a blank replacement page.
    expect(screen.getByRole("link", { name: /^assessments$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("still renders the matched page normally for a known route when authenticated", () => {
    renderApp("/assessments", "test-token");

    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor hitting an unmatched path to /login instead of showing the 404 with chrome", () => {
    renderApp("/this/route/does/not/exist", null);

    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /logout/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ai interview/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
  });
});
