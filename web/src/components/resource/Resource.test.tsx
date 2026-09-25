import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Resource from "./Resource";
import type { ResourceState } from "@/types";

interface Fixture {
  status: "pending" | "active" | "ended";
  name: string;
}

function renderResource(
  resource: ResourceState<Fixture>,
  isValidState?: (data: Fixture) => boolean
) {
  return render(
    <MemoryRouter>
      <Resource resource={resource} isValidState={isValidState}>
        {(data) => <div data-testid="ready-content">{data.name}</div>}
      </Resource>
    </MemoryRouter>
  );
}

describe("<Resource>", () => {
  it("renders <LoadingState> for the loading state", () => {
    renderResource({ status: "loading" });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders <EmptyState> for the empty state", () => {
    renderResource({ status: "empty" });
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it("renders <ErrorState> for the error state", () => {
    renderResource({ status: "error", error: new Error("network down") });
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("renders <NotFoundState> for the not-found state", () => {
    renderResource({ status: "not-found" });
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it("renders <ForbiddenState>, not a redirect, for the forbidden state", () => {
    renderResource({ status: "forbidden" });
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    // No navigation-triggering elements (e.g. a redirect would render nothing here at all).
    expect(screen.queryByTestId("ready-content")).not.toBeInTheDocument();
  });

  it("renders the wrong-state presentation for the wrong-state state", () => {
    renderResource({ status: "wrong-state", data: { status: "pending", name: "Ali" } });
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
  });

  it("renders the caller's children for the ready state", () => {
    renderResource({ status: "ready", data: { status: "active", name: "Ali" } });
    expect(screen.getByTestId("ready-content")).toHaveTextContent("Ali");
  });

  it("reclassifies a would-be-ready result as wrong-state when isValidState returns false", () => {
    renderResource(
      { status: "ready", data: { status: "pending", name: "Ali" } },
      (data) => data.status === "active"
    );
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("ready-content")).not.toBeInTheDocument();
  });

  it("renders children when isValidState returns true", () => {
    renderResource(
      { status: "ready", data: { status: "active", name: "Ali" } },
      (data) => data.status === "active"
    );
    expect(screen.getByTestId("ready-content")).toHaveTextContent("Ali");
  });

  it("lets a caller override a state's presentation", () => {
    const resource: ResourceState<Fixture> = { status: "empty" };
    render(
      <MemoryRouter>
        <Resource<Fixture> resource={resource} empty={<div>Custom empty copy</div>}>
          {(data) => <div data-testid="ready-content">{data.name}</div>}
        </Resource>
      </MemoryRouter>
    );
    expect(screen.getByText("Custom empty copy")).toBeInTheDocument();
  });
});
