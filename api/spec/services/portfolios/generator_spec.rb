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
          model_name:     portfolio[:model_name],
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
          expect(portfolio[:model_name]).to eq(previous_state[:model_name])
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

  describe "#call — provenance on success (AC47)" do
    let(:batch) do
      { "configured_skills" => [skill_payload(skill_id: "sk-1", label: "Skill A", level: 3)], "discovered_skills" => [] }
    end
    let(:generator) { described_class.new(session: session, gemini_client: gemini_double(batch)) }
    let!(:portfolio) { generator.call }

    it "records the model_name used for the generation" do
      expect(portfolio[:model_name]).to eq(ENV.fetch("GEMINI_PRO_MODEL", "gemini-2.5-flash"))
    end

    it "records prompt_version as the sha256 digest of the assembled prompt" do
      expected_prompt = generator.send(:build_prompt)
      expect(portfolio.prompt_version).to eq(Digest::SHA256.hexdigest(expected_prompt))
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
