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
// Follow-up (grill-me): both auth states show the real 404 — never a
// redirect — but the surrounding shell differs. An authenticated user sees
// it inside AssessorLayout's normal nav chrome, same as every other assessor
// route. An unauthenticated visitor never sees that authenticated chrome for
// an unmatched URL; they get the minimal CandidateLayout shell instead, with
// "back" pointing at /login rather than the unreachable /assessments.
// See CatchAllRoute.
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
  it("renders <NotFoundState> inside AssessorLayout's chrome for an authenticated user on an unmatched path", () => {
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

  it("renders <NotFoundState> inside the minimal CandidateLayout shell for an unauthenticated visitor, never the authenticated chrome", () => {
    renderApp("/this/route/does/not/exist", null);

    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /logout/i })).not.toBeInTheDocument();

    // CandidateLayout's minimal header (no nav), not AssessorLayout's.
    expect(screen.getByText(/^ai interview$/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^assessments$/i })).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: /go to login/i })).toHaveAttribute("href", "/login");
  });
});
