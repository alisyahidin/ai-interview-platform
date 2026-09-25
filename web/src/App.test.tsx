import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import App from "./App";

// Ticket #14 (F24): there was no catch-all route, so an unknown URL rendered
// nothing inside the layout. This proves the routing wiring end to end —
// <Resource>/<NotFoundState>'s own presentation is covered by their own
// component tests, this just proves the unmatched path actually reaches it.
function renderApp(path: string) {
  return render(
    <JotaiProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </JotaiProvider>
  );
}

describe("App routing — catch-all 404", () => {
  it("renders <NotFoundState> content inside the layout for an unmatched path", () => {
    renderApp("/this/route/does/not/exist");

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

  it("still renders the matched page normally for a known route", () => {
    renderApp("/assessments");

    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });
});
