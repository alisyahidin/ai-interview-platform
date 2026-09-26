import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import SkillPortfolioCard from "./SkillPortfolioCard";
import type { PortfolioSkill } from "@/types";

// Ticket #23 (Phase 3b #2): the judgment badges/states — assessed
// (high/medium confidence), tentative (assessed + low confidence),
// not-assessed (with each `status_reason`), and the orthogonal
// `needs_review` flag layered on top of either base state. Rendered
// against realistic skill payloads (the shape the portfolio-skill JSON
// contract is moving to per #22/#23), matching this project's existing
// component-test style rather than asserting on internals.

function makeSkill(overrides: Partial<PortfolioSkill> = {}): PortfolioSkill {
  return {
    id: 1,
    skill_id: "react",
    skill_label: "React",
    is_discovered: false,
    ai_level: 3,
    ai_confidence: "high",
    assessment_status: "assessed",
    status_reason: null,
    evidence: ["Explained the reconciliation algorithm clearly."],
    competency_summary: "Solid grasp of component design.",
    ...overrides,
  };
}

async function expectNoSeriousViolations(container: HTMLElement) {
  const results = await axe(container);
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
  expect(serious).toEqual([]);
}

describe("SkillPortfolioCard", () => {
  it("renders an assessed/high-confidence skill as a solid badge with level, evidence, and a confidence label (AC1)", async () => {
    const skill = makeSkill({ ai_confidence: "high" });
    const { container } = render(
      <SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />
    );

    expect(screen.getByText("L3")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText(/reconciliation algorithm/i)).toBeInTheDocument();
    expect(screen.queryByText(/not assessed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument();

    await expectNoSeriousViolations(container);
  });

  it("renders an assessed/medium-confidence skill with the same solid badge, differing only in the confidence label", () => {
    const skill = makeSkill({ ai_confidence: "medium" });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    expect(screen.getByText("L3")).toBeInTheDocument();
    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
  });

  it("renders a low-confidence skill with tentative, outlined treatment distinct from a firm result (AC3)", async () => {
    const skill = makeSkill({ ai_confidence: "low" });
    const { container } = render(
      <SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />
    );

    expect(screen.getByText("L3")).toBeInTheDocument();
    // Confidence label reads as tentative language, not a raw "low" readout.
    expect(screen.getAllByText(/limited evidence/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/tentative/i)).toBeInTheDocument();

    await expectNoSeriousViolations(container);
  });

  it("renders a not-assessed skill with a neutral badge, no number, and the 'omitted_by_model' reason (AC2)", async () => {
    const skill = makeSkill({
      assessment_status: "not_assessed",
      status_reason: "omitted_by_model",
      ai_level: null,
      evidence: [],
    });
    const { container } = render(
      <SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />
    );

    expect(screen.getByText(/not assessed in this interview/i)).toBeInTheDocument();
    expect(screen.getByText(/didn't produce a rating/i)).toBeInTheDocument();
    expect(screen.queryByText("L3")).not.toBeInTheDocument();
    // Never styled as a failure/destructive state.
    expect(screen.queryByText(/fail/i)).not.toBeInTheDocument();

    await expectNoSeriousViolations(container);
  });

  it("renders a not-assessed skill with distinct copy for 'invalid_model_output'", () => {
    const skill = makeSkill({
      assessment_status: "not_assessed",
      status_reason: "invalid_model_output",
      ai_level: null,
      evidence: [],
    });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    expect(screen.getByText(/couldn't be understood and was discarded/i)).toBeInTheDocument();
  });

  it("falls back to a generic explanation when a not-assessed skill has no status_reason", () => {
    const skill = makeSkill({
      assessment_status: "not_assessed",
      status_reason: null,
      ai_level: null,
      evidence: [],
    });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    expect(screen.getByText(/wasn't measured during the interview/i)).toBeInTheDocument();
  });

  it("layers the needs_review flag on top of an assessed skill and opens the override panel on activation (AC4)", async () => {
    const user = userEvent.setup();
    const skill = makeSkill({ assessment_status: "needs_review", ai_confidence: "high" });
    const { container } = render(
      <SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />
    );

    // Still reads as the assessed solid state, plus the orthogonal flag.
    expect(screen.getByText("L3")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    const flag = screen.getByRole("button", { name: /needs review/i });
    expect(flag).toBeInTheDocument();

    // Override panel starts collapsed...
    expect(screen.queryByRole("group", { name: /override rating/i })).not.toBeInTheDocument();

    await user.click(flag);

    // ...and the CTA opens/focuses the existing OverridePanel.
    const panel = await screen.findByRole("group", { name: /override rating/i });
    expect(panel).toHaveFocus();

    await expectNoSeriousViolations(container);
  });

  it("layers the needs_review flag on top of a tentative (low-confidence) skill", async () => {
    const user = userEvent.setup();
    const skill = makeSkill({ assessment_status: "needs_review", ai_confidence: "low" });
    const { container } = render(
      <SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />
    );

    expect(screen.getAllByText(/limited evidence/i).length).toBeGreaterThan(0);
    const flag = screen.getByRole("button", { name: /needs review/i });

    await user.click(flag);
    expect(await screen.findByRole("group", { name: /override rating/i })).toBeInTheDocument();

    await expectNoSeriousViolations(container);
  });

  it("clamps a very long evidence quote to 3 lines with a Show more control (AC38)", async () => {
    const user = userEvent.setup();
    const longQuote = "A".repeat(2000);
    const skill = makeSkill({ evidence: [longQuote] });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /show more/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: /show less/i })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("shows an explicit empty state for zero evidence quotes instead of blank space (AC38)", () => {
    const skill = makeSkill({ evidence: [] });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    expect(
      screen.getByText(/no evidence quotes were captured for this skill/i)
    ).toBeInTheDocument();
  });

  it("truncates a very long skill name but keeps the full value keyboard-accessible via a tooltip (AC39)", async () => {
    const longName =
      "Distributed Systems Architecture and Fault-Tolerant Consensus Protocol Design";
    const skill = makeSkill({ skill_label: longName });
    render(<SkillPortfolioCard skill={skill} onOverrideSaved={vi.fn()} />);

    // Same shared `TruncatedText` component the fit/gap comparison table
    // uses (AC39) — a focusable span, not a plain `title` attribute that
    // only mouse hover could reach.
    const nameEl = screen.getByText(longName);
    expect(nameEl).toHaveClass("truncate");
    expect(nameEl).toHaveAttribute("tabIndex", "0");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Keyboard focus alone (no hover) must reveal the full name.
    fireEvent.focus(nameEl);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(longName);
  });
});
