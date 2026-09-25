# frozen_string_literal: true

require "rails_helper"

# Ticket #8: Portfolios::Generator#save_skills rewritten around
# Portfolios::LevelNormalizer (#7) and the assessment-truth schema (#6).
#
# AC45: an invalid skill anywhere in the batch rolls back the *entire*
#       transaction -- the portfolio keeps whatever it had before this
#       generation attempt.
# AC40-44: normalizer outcomes (assessed/not_assessed/needs_review) are
#          correctly persisted -- this proves the wiring, not the
#          normalizer's own input-shape matrix (already covered by #7's
#          spec).
# AC47: a successful generation records model_name and prompt_version.
# Failure classification: timeout / invalid_output / upstream_error /
#          unknown each produce a distinct, correctly-mapped failure_code.
#
# A fake gemini_client: is injected throughout -- spec/support/webmock.rb
# hard-blocks real outbound HTTP in the test environment.
RSpec.describe Portfolios::Generator do
  let(:session) { create(:session) }

  def gemini_double(payload)
    instance_double(Gemini::HttpClient, generate_content: payload)
  end

  def raising_gemini_double(error_class, message)
    instance_double(Gemini::HttpClient).tap do |client|
      allow(client).to receive(:generate_content).and_raise(error_class, message)
    end
  end

  def skill_payload(skill_id:, label:, level:, confidence: "medium")
    {
      "skill_id"           => skill_id,
      "skill_label"        => label,
      "level"              => level,
      "confidence"         => confidence,
      "evidence"           => ["Some supporting quote."],
      "competency_summary" => "A short competency summary."
    }
  end

  # Calls generator.call and returns the raised error (or nil on success),
  # so each spec below can make one assertion -- either on what was raised,
  # or on the resulting DB state -- without invoking generation twice.
  def call_capturing_error(generator)
    generator.call
    nil
  rescue StandardError => e
    e
  end

  describe "#call — transactional rollback on an invalid skill (AC45)" do
    # Plain methods, not `let`, so each context below stays under the
    # memoized-helper budget -- these build fresh, side-effect-free hashes
    # each time they're called, so memoization buys nothing here anyway.
    def valid_batch
      {
        "configured_skills" => [
          skill_payload(skill_id: "sk-1", label: "Skill A", level: 3),
          skill_payload(skill_id: "sk-2", label: "Skill B", level: 4),
          skill_payload(skill_id: "sk-3", label: "Skill C", level: 2),
          skill_payload(skill_id: "sk-4", label: "Skill D", level: 5),
          skill_payload(skill_id: "sk-5", label: "Skill E", level: 1)
        ],
        "discovered_skills" => []
      }
    end

    def invalid_batch
      {
        "configured_skills" => [
          skill_payload(skill_id: "sk-1", label: "Skill A", level: 4),
          skill_payload(skill_id: "sk-2", label: "Skill B", level: 3),
          skill_payload(skill_id: "sk-3", label: "Skill C", level: 7), # 3rd of 5 -- invalid
          skill_payload(skill_id: "sk-4", label: "Skill D", level: 2),
          skill_payload(skill_id: "sk-5", label: "Skill E", level: 5)
        ],
        "discovered_skills" => []
      }
    end

    def invalid_generator
      described_class.new(session: session, gemini_client: gemini_double(invalid_batch))
    end

    context "when a prior successful generation already saved skills" do
      let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(valid_batch)).call }
      let!(:previous_state) do
        {
          skill_ids:      portfolio.portfolio_skills.order(:skill_id).pluck(:id),
          model_name:     portfolio.gemini_model_name,
          prompt_version: portfolio.prompt_version
        }
      end
      let!(:raised_error) { call_capturing_error(invalid_generator) }

      it "raises InvalidModelOutputError" do
        expect(raised_error).to be_a(Portfolios::Generator::InvalidModelOutputError)
      end

      it "marks the portfolio failed" do
        expect(portfolio.reload.generation_status).to eq("failed")
      end

      it "records failure_code invalid_output" do
        expect(portfolio.reload.failure_code).to eq("invalid_output")
      end

      it "keeps the exact same skill records (nothing destroyed or recreated)" do
        expect(portfolio.reload.portfolio_skills.order(:skill_id).pluck(:id)).to eq(previous_state[:skill_ids])
      end

      it "keeps the old ai_level for the skill the failed batch tried to change" do
        expect(portfolio.portfolio_skills.find_by(skill_id: "sk-3").ai_level).to eq(2)
      end

      it "does not overwrite the previous provenance" do
        portfolio.reload
        aggregate_failures do
          expect(portfolio.gemini_model_name).to eq(previous_state[:model_name])
          expect(portfolio.prompt_version).to eq(previous_state[:prompt_version])
        end
      end
    end

    context "when there was no prior portfolio" do
      let!(:raised_error) { call_capturing_error(invalid_generator) }

      it "raises InvalidModelOutputError" do
        expect(raised_error).to be_a(Portfolios::Generator::InvalidModelOutputError)
      end

      it "still marks the (newly created) portfolio failed with invalid_output" do
        expect(session.reload.portfolio).to have_attributes(generation_status: "failed", failure_code: "invalid_output")
      end

      it "persists no portfolio_skills at all" do
        expect(session.reload.portfolio.portfolio_skills).to be_empty
      end
    end
  end

  describe "#call — mixed assessed / not_assessed / needs_review batch" do
    before { create(:coverage_map, session: session, skill_label: "Disputed Skill", state: "not_yet") }

    let(:mixed_batch) do
      {
        "configured_skills" => [
          skill_payload(skill_id: "sk-1", label: "Clean Skill", level: 3, confidence: "high"),
          skill_payload(skill_id: "sk-2", label: "Unmeasured Skill", level: "N/A", confidence: "low"),
          skill_payload(skill_id: "sk-3", label: "Disputed Skill", level: 4, confidence: "medium")
        ],
        "discovered_skills" => []
      }
    end
    let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(mixed_batch)).call }

    it "completes generation successfully" do
      expect(portfolio.generation_status).to eq("complete")
    end

    it "persists a cleanly-scored skill as assessed" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-1")).to have_attributes(
        assessment_status: "assessed", ai_level: 3, status_reason: nil
      )
    end

    it "persists an unmeasured skill as not_assessed with a nil level" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-2")).to have_attributes(
        assessment_status: "not_assessed", ai_level: nil
      )
    end

    it "persists a skill scored despite not_yet coverage as needs_review, keeping its level" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-3")).to have_attributes(
        assessment_status: "needs_review", ai_level: 4
      )
    end
  end

  # AC42 (#7/#8): a skill configured on the assessment (the same list
  # `build_prompt` sends the model) that the model's JSON drops entirely --
  # not scored "N/A", genuinely absent from `configured_skills` -- must
  # still end up with a row, not silently end up with none at all.
  describe "#call — configured skill entirely omitted by the model (AC42)" do
    before do
      create(:assessment_skill, assessment: session.assessment, skill_id: "sk-ghost", skill_label: "Ghost Skill")
    end

    let(:batch_missing_ghost) do
      {
        "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Clean Skill", level: 3)],
        "discovered_skills" => []
      }
    end

    let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(batch_missing_ghost)).call }

    it "completes generation successfully" do
      expect(portfolio.generation_status).to eq("complete")
    end

    it "creates a row for the omitted configured skill instead of leaving it out" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-ghost")).to be_present
    end

    it "marks the omitted skill not_assessed with reason omitted_by_model" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-ghost")).to have_attributes(
        assessment_status: "not_assessed", status_reason: "omitted_by_model", ai_level: nil
      )
    end

    it "still persists the skill the model did return, unaffected" do
      expect(portfolio.portfolio_skills.find_by(skill_id: "sk-1")).to have_attributes(
        assessment_status: "assessed", ai_level: 3
      )
    end
  end

  describe "#call — provenance on success (AC47)" do
    let(:batch) do
      { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: 3)], "discovered_skills" => [] }
    end
    let(:generator) { described_class.new(session: session, gemini_client: gemini_double(batch)) }
    let!(:portfolio) { generator.call }

    it "records the model_name used for the generation" do
      expect(portfolio.gemini_model_name).to eq(ENV.fetch("GEMINI_PRO_MODEL", "gemini-2.5-flash"))
    end

    it "records prompt_version as the sha256 digest of the assembled prompt" do
      expected_prompt = generator.send(:build_prompt)
      expect(portfolio.prompt_version).to eq(Digest::SHA256.hexdigest(expected_prompt))
    end
  end

  describe "#call — override preservation across regeneration (#9)" do
    # Regenerates `portfolio` from `batch` and returns the fresh copy of
    # `skill_id`/`skill_label`'s portfolio_skill row. A plain helper method
    # (not `let`) so it doesn't count against the memoized-helper budget,
    # matching this file's existing `valid_batch`/`invalid_batch` pattern.
    def regenerate_and_find(portfolio, batch, skill_id: nil, skill_label: nil)
      described_class.new(session: portfolio.session, gemini_client: gemini_double(batch)).call
      scope = portfolio.reload.portfolio_skills
      skill_id ? scope.find_by!(skill_id: skill_id) : scope.find_by!(skill_label: skill_label)
    end

    # AC46: overrides preserved and re-attached by `skill_id` across a
    # regeneration.
    context "when a configured skill's override matches the new batch by skill_id" do
      def first_batch
        { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: 2)], "discovered_skills" => [] }
      end

      def second_batch
        { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: 4)], "discovered_skills" => [] }
      end

      let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(first_batch)).call }
      let!(:old_skill) { portfolio.portfolio_skills.find_by!(skill_id: "sk-1") }
      let!(:override) do
        create(:assessor_override, portfolio_skill: old_skill, ai_level: 2, override_level: 5,
                                    assessor_notes: "Stronger than the AI score.", overridden_by: 42)
      end
      let(:new_skill) { regenerate_and_find(portfolio, second_batch, skill_id: "sk-1") }

      it "re-attaches the override to the new portfolio_skill record, not the old one" do
        aggregate_failures do
          expect(new_skill.assessor_override.portfolio_skill_id).to eq(new_skill.id)
          expect(new_skill.id).not_to eq(old_skill.id)
          expect(PortfolioSkill.find_by(id: old_skill.id)).to be_nil
        end
      end

      it "preserves the human judgment fields from the original override" do
        expect(new_skill.assessor_override).to have_attributes(
          override_level: override.override_level, assessor_notes: override.assessor_notes,
          overridden_by: override.overridden_by, overridden_at: override.overridden_at
        )
      end

      it "refreshes ai_level to the new skill's own (re-measured) level" do
        aggregate_failures do
          expect(new_skill.ai_level).to eq(4)
          expect(new_skill.assessor_override.ai_level).to eq(4)
        end
      end
    end

    # Discovered-skill override (no `skill_id`) re-attaches by `skill_label`.
    context "when a discovered skill's override matches the new batch by skill_label" do
      def first_batch
        { "configured_skills" => [], "discovered_skills" => [skill_payload(skill_id: nil, label: "Custom Skill", level: 2)] }
      end

      def second_batch
        { "configured_skills" => [], "discovered_skills" => [skill_payload(skill_id: nil, label: "Custom Skill", level: 5)] }
      end

      let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(first_batch)).call }
      let!(:old_skill) { portfolio.portfolio_skills.find_by!(skill_label: "Custom Skill") }
      let!(:override) do
        create(:assessor_override, portfolio_skill: old_skill, ai_level: 2, override_level: 3, overridden_by: 7)
      end
      let(:new_skill) { regenerate_and_find(portfolio, second_batch, skill_label: "Custom Skill") }

      it "re-attaches the override to the new discovered-skill record by label" do
        aggregate_failures do
          expect(new_skill.skill_id).to be_nil
          expect(new_skill.assessor_override).to have_attributes(portfolio_skill_id: new_skill.id, override_level: override.override_level, ai_level: 5)
        end
      end
    end

    # An override whose skill is absent from the new batch is neither
    # deleted nor silently reapplied -- it's preserved in an unlinked state.
    context "when the override's matching skill is absent from the new batch" do
      def first_batch
        {
          "configured_skills" => [
            skill_payload(skill_id: "sk-removed", label: "Removed Skill", level: 3),
            skill_payload(skill_id: "sk-stays", label: "Staying Skill", level: 3)
          ],
          "discovered_skills" => []
        }
      end

      def second_batch
        { "configured_skills" => [skill_payload(skill_id: "sk-stays", label: "Staying Skill", level: 4)], "discovered_skills" => [] }
      end

      let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(first_batch)).call }
      let!(:removed_skill) { portfolio.portfolio_skills.find_by!(skill_id: "sk-removed") }
      let!(:override) do
        create(:assessor_override, portfolio_skill: removed_skill, ai_level: 3, override_level: 1, overridden_by: 9)
      end

      before { described_class.new(session: session, gemini_client: gemini_double(second_batch)).call }

      it "regenerates without raising and completes the portfolio" do
        expect(portfolio.reload.generation_status).to eq("complete")
      end

      it "preserves the override row, still pointed at the old superseded skill" do
        aggregate_failures do
          expect(AssessorOverride.find_by(id: override.id)).to be_present
          expect(override.reload.portfolio_skill_id).to eq(removed_skill.id)
          expect(PortfolioSkill.find_by(id: removed_skill.id)).to be_present
        end
      end

      it "does not attach the preserved override to the unrelated skill that did carry over" do
        staying_skill = portfolio.reload.portfolio_skills.find_by!(skill_id: "sk-stays")
        expect(staying_skill.assessor_override).to be_nil
      end
    end

    # Same skill_id reappears, but the model no longer measures it
    # (`ai_level` nil). There is no valid `ai_level` to reattach the
    # override against, so it's preserved unlinked rather than raising a
    # validation error or attaching with a fabricated level.
    context "when the matching skill regenerates as not_assessed (nil ai_level)" do
      def first_batch
        { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: 3)], "discovered_skills" => [] }
      end

      def second_batch
        { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: "N/A")], "discovered_skills" => [] }
      end

      let!(:portfolio) { described_class.new(session: session, gemini_client: gemini_double(first_batch)).call }
      let!(:old_skill) { portfolio.portfolio_skills.find_by!(skill_id: "sk-1") }
      let!(:override) do
        create(:assessor_override, portfolio_skill: old_skill, ai_level: 3, override_level: 5, overridden_by: 3)
      end
      # Preserved orphan (level 3) + this generation's not_assessed row.
      let(:new_skill) { portfolio.reload.portfolio_skills.where(skill_id: "sk-1").find { |s| s.id != old_skill.id } }

      before { described_class.new(session: session, gemini_client: gemini_double(second_batch)).call }

      it "creates a fresh not_assessed row without attaching the override to it" do
        aggregate_failures do
          expect(portfolio.portfolio_skills.where(skill_id: "sk-1").count).to eq(2)
          expect(new_skill.ai_level).to be_nil
          expect(new_skill.assessor_override).to be_nil
        end
      end

      it "preserves the override, still pointed at the old skill record" do
        aggregate_failures do
          expect(AssessorOverride.find_by(id: override.id)).to be_present
          expect(override.reload.portfolio_skill_id).to eq(old_skill.id)
        end
      end
    end
  end

  describe "#call — failure classification" do
    context "when the Gemini client times out" do
      let(:generator) { described_class.new(session: session, gemini_client: raising_gemini_double(Gemini::HttpClient::TimeoutError, "timed out")) }
      let!(:raised_error) { call_capturing_error(generator) }

      it "raises the timeout error" do
        expect(raised_error).to be_a(Gemini::HttpClient::TimeoutError)
      end

      it "records failure_code timeout" do
        expect(session.reload.portfolio.failure_code).to eq("timeout")
      end
    end

    context "when the model output is not valid JSON" do
      let(:generator) { described_class.new(session: session, gemini_client: gemini_double("this is not valid json {")) }
      let!(:raised_error) { call_capturing_error(generator) }

      it "raises InvalidModelOutputError" do
        expect(raised_error).to be_a(Portfolios::Generator::InvalidModelOutputError)
      end

      it "records failure_code invalid_output" do
        expect(session.reload.portfolio.failure_code).to eq("invalid_output")
      end
    end

    context "when the Gemini client raises a generic API error" do
      let(:generator) { described_class.new(session: session, gemini_client: raising_gemini_double(Gemini::HttpClient::ApiError, "API returned 500")) }
      let!(:raised_error) { call_capturing_error(generator) }

      it "raises the API error" do
        expect(raised_error).to be_a(Gemini::HttpClient::ApiError)
      end

      it "records failure_code upstream_error" do
        expect(session.reload.portfolio.failure_code).to eq("upstream_error")
      end
    end

    context "when an unclassified error occurs" do
      let(:generator) { described_class.new(session: session, gemini_client: raising_gemini_double(StandardError, "something unexpected")) }
      let!(:raised_error) { call_capturing_error(generator) }

      it "still raises the original error" do
        expect(raised_error).to have_attributes(class: StandardError, message: "something unexpected")
      end

      it "records failure_code unknown" do
        expect(session.reload.portfolio.failure_code).to eq("unknown")
      end
    end
  end
end
