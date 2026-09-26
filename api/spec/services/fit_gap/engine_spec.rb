# frozen_string_literal: true

require "rails_helper"

# Ticket #10: once ai_level can be nil (issue #6), a *matched* portfolio_skill
# can itself be not_assessed/needs_review, not just "no match at all". These
# specs prove build_skill_comparisons doesn't attempt
# `candidate_level - expected_level` against nil for a not_assessed skill,
# and — per the fix to `assessed?` — that a needs_review skill DOES get a
# real candidate_level/delta/result/confidence computed against the expected
# level (its ai_level is always real; only `assessment_status` stays
# 'needs_review' on the row, so the frontend can render the review flag
# independently of whatever result that computation lands on). A fake
# gemini_client: is injected throughout — spec/support/webmock.rb hard-blocks
# real outbound HTTP in the test environment.
RSpec.describe FitGap::Engine do
  let(:vacancy) { create(:vacancy) }
  let(:session) { create(:session) }
  let(:portfolio) { create(:portfolio, session: session) }
  let(:gemini_client) do
    instance_double(Gemini::HttpClient, generate_content: { "culture_narrative" => "narrative", "overall_narrative" => "overall" })
  end
  let(:engine) { described_class.new(portfolio: portfolio, vacancy: vacancy, gemini_client: gemini_client) }

  def add_vacancy_skill(label:, skill_id:, expected_level:)
    create(:vacancy_skill, vacancy: vacancy, skill_label: label, skill_id: skill_id, expected_level: expected_level)
  end

  def comparison_for(report, label)
    report.reload.skill_comparisons.find { |c| c["skill_label"] == label }
  end

  describe "#call — assessed skills (regression guard)" do
    before do
      add_vacancy_skill(label: "Match Skill", skill_id: "s-1", expected_level: 3)
      add_vacancy_skill(label: "Gap Skill", skill_id: "s-2", expected_level: 4)
      add_vacancy_skill(label: "Exceed Skill", skill_id: "s-3", expected_level: 2)
      create(:portfolio_skill, portfolio: portfolio, skill_label: "Match Skill", skill_id: "s-1", ai_level: 3)
      create(:portfolio_skill, portfolio: portfolio, skill_label: "Gap Skill", skill_id: "s-2", ai_level: 2)
      create(:portfolio_skill, portfolio: portfolio, skill_label: "Exceed Skill", skill_id: "s-3", ai_level: 4)
    end

    it "classifies an equal level as a match" do
      expect(comparison_for(engine.call, "Match Skill")).to include("result" => "match", "candidate_level" => 3, "delta" => 0)
    end

    it "classifies a lower candidate level as a gap" do
      expect(comparison_for(engine.call, "Gap Skill")).to include("result" => "gap", "candidate_level" => 2, "delta" => -2)
    end

    it "classifies a higher candidate level as an exceed" do
      expect(comparison_for(engine.call, "Exceed Skill")).to include("result" => "exceed", "candidate_level" => 4, "delta" => 2)
    end
  end

  describe "#call — matched but not_assessed portfolio_skill" do
    before do
      add_vacancy_skill(label: "Unmeasured Skill", skill_id: "unmeasured", expected_level: 4)
      create(:portfolio_skill, :not_assessed, portfolio: portfolio, skill_label: "Unmeasured Skill", skill_id: "unmeasured")
    end

    it "produces the not_assessed shape instead of raising on nil ai_level" do
      expect(comparison_for(engine.call, "Unmeasured Skill")).to include(
        "result" => "not_assessed", "candidate_level" => nil, "delta" => nil, "confidence" => nil
      )
    end
  end

  describe "#call — matched but needs_review portfolio_skill" do
    before do
      add_vacancy_skill(label: "Disputed Skill", skill_id: "disputed", expected_level: 3)
      create(:portfolio_skill, :needs_review, portfolio: portfolio, skill_label: "Disputed Skill", skill_id: "disputed", ai_level: 5)
    end

    it "computes a real comparison against ai_level instead of collapsing to the not_assessed shape" do
      expected = { "result" => "exceed", "candidate_level" => 5, "delta" => 2,
                   "confidence" => "medium", "assessment_status" => "needs_review" }
      expect(comparison_for(engine.call, "Disputed Skill")).to include(expected)
    end

    context "when the narrative call fails and the engine falls back" do
      let(:gemini_client) { instance_double(Gemini::HttpClient) }

      before do
        allow(gemini_client).to receive(:generate_content).and_raise(StandardError, "narrative generation unavailable")
        add_vacancy_skill(label: "Matched Skill", skill_id: "matched", expected_level: 3)
        create(:portfolio_skill, portfolio: portfolio, skill_label: "Matched Skill", skill_id: "matched", ai_level: 3)
      end

      it "counts the needs_review skill under its real result (exceed), not as not-assessed" do
        expect(engine.call.reload.overall_narrative).to eq(
          "Candidate shows 1 skill matches, 1 exceeds, and 0 gaps against role requirements, " \
          "with 0 skills not assessed in this interview."
        )
      end
    end
  end

  describe "#call — fallback narrative counts not-assessed skills honestly (AC12, F33)" do
    let(:gemini_client) { instance_double(Gemini::HttpClient) }

    before do
      allow(gemini_client).to receive(:generate_content).and_raise(StandardError, "narrative generation unavailable")
      add_vacancy_skill(label: "Matched Skill", skill_id: "matched", expected_level: 3)
      create(:portfolio_skill, portfolio: portfolio, skill_label: "Matched Skill", skill_id: "matched", ai_level: 3)
      add_vacancy_skill(label: "Unmeasured Skill A", skill_id: "unmeasured-a", expected_level: 4)
      create(:portfolio_skill, :not_assessed, portfolio: portfolio, skill_label: "Unmeasured Skill A", skill_id: "unmeasured-a")
      add_vacancy_skill(label: "Unmeasured Skill B", skill_id: "unmeasured-b", expected_level: 2)
      create(:portfolio_skill, :not_assessed, portfolio: portfolio, skill_label: "Unmeasured Skill B", skill_id: "unmeasured-b")
    end

    it "names the not-assessed count instead of silently omitting it" do
      expect(engine.call.reload.overall_narrative).to eq(
        "Candidate shows 1 skill matches, 0 exceeds, and 0 gaps against role requirements, " \
        "with 2 skills not assessed in this interview."
      )
    end
  end
end
