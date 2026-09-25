# frozen_string_literal: true

require "rails_helper"

# Ticket #10: once ai_level can be nil (issue #6), a *matched* portfolio_skill
# can itself be not_assessed/needs_review, not just "no match at all". These
# specs prove build_skill_comparisons doesn't attempt
# `candidate_level - expected_level` against nil in that case, and that
# needs_review is excluded from the fallback narrative's gap/match/exceed
# counts. A fake gemini_client: is injected throughout — spec/support/webmock.rb
# hard-blocks real outbound HTTP in the test environment.
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

    it "produces the not_assessed shape even though ai_level is present" do
      expect(comparison_for(engine.call, "Disputed Skill")).to include(
        "result" => "not_assessed", "candidate_level" => nil, "delta" => nil
      )
    end

    context "when the narrative call fails and the engine falls back" do
      let(:gemini_client) { instance_double(Gemini::HttpClient) }

      before do
        allow(gemini_client).to receive(:generate_content).and_raise(StandardError, "narrative generation unavailable")
        add_vacancy_skill(label: "Matched Skill", skill_id: "matched", expected_level: 3)
        create(:portfolio_skill, portfolio: portfolio, skill_label: "Matched Skill", skill_id: "matched", ai_level: 3)
      end

      it "excludes the needs_review skill from the fallback match/gap/exceed counts" do
        expect(engine.call.reload.overall_narrative).to eq(
          "Candidate shows 1 skill matches, 0 exceeds, and 0 gaps against role requirements."
        )
      end
    end
  end
end
