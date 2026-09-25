import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RouteErrorBoundary from "./RouteErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

// Stands in for a Layout (AssessorLayout/CandidateLayout): chrome that must
// stay mounted and interactive even when the routed page inside <Outlet/>
// throws, plus the `key={pathname}` wiring the real layouts use to reset the
// boundary on navigation.
function FakeLayout({ path, throwError }: { path: string; throwError: boolean }) {
  return (
    <div>
      <nav data-testid="layout-nav">Layout chrome</nav>
      <RouteErrorBoundary key={path}>
        {throwError ? <Bomb /> : <div data-testid="page-content">Page: {path}</div>}
      </RouteErrorBoundary>
    </div>
  );
}

describe("<RouteErrorBoundary>", () => {
  it("renders its children when nothing throws", () => {
    render(<FakeLayout path="/a" throwError={false} />);
    expect(screen.getByTestId("page-content")).toHaveTextContent("Page: /a");
  });

  it("catches a throwing child, renders the fallback, and keeps the surrounding layout mounted", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<FakeLayout path="/a" throwError={true} />);

    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();
    // The Layout chrome around the boundary is untouched and still rendered.
    expect(screen.getByTestId("layout-nav")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("resets when the keyed location.pathname changes, so navigating away recovers without a reload", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(<FakeLayout path="/a" throwError={true} />);
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();

    // Simulate navigating to a different route: the pathname (and therefore
    // the boundary's key) changes, and the new page doesn't throw.
    rerender(<FakeLayout path="/b" throwError={false} />);

    expect(screen.queryByText(/couldn't be displayed/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("page-content")).toHaveTextContent("Page: /b");

    consoleError.mockRestore();
  });

  it("does not reset on a re-render that keeps the same pathname key", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(<FakeLayout path="/a" throwError={true} />);
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();

    // Same path -> same key -> React does not remount the boundary, so it
    // keeps showing the cached fallback even though this child wouldn't throw.
    rerender(<FakeLayout path="/a" throwError={false} />);
    expect(screen.getByText(/couldn't be displayed/i)).toBeInTheDocument();

    consoleError.mockRestore();
  });
});
