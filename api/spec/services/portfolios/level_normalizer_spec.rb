# frozen_string_literal: true

require "rails_helper"

RSpec.describe Portfolios::LevelNormalizer do
  def normalize(level: nil, confidence: nil, coverage_state: nil, omitted: false)
    described_class.call(level: level, confidence: confidence, coverage_state: coverage_state, omitted: omitted)
  end

  describe "no-measurement levels (AC40)" do
    [nil, "N/A", "n/a", 0, "0", "", "   ", "unknown"].each do |raw|
      it "treats #{raw.inspect} as not_assessed, never coerced to a number" do
        expect(normalize(level: raw)).to have_attributes(assessment_status: :not_assessed, level: nil)
      end
    end

    it "records no status_reason for a bare no-measurement level (distinct from omission)" do
      expect(normalize(level: nil).status_reason).to be_nil
    end
  end

  describe "valid and invalid numeric levels (AC41)" do
    it "accepts a numeric-string level and returns it as an integer" do
      expect(normalize(level: "3")).to have_attributes(assessment_status: :assessed, level: 3)
    end

    it "accepts an integer level in range" do
      expect(normalize(level: 5)).to have_attributes(assessment_status: :assessed, level: 5)
    end

    it "marks an out-of-range integer (7) as invalid, not clamped" do
      expect(normalize(level: 7)).to have_attributes(
        assessment_status: :invalid, level: nil, status_reason: :invalid_model_output
      )
    end

    it "marks a negative out-of-range integer as invalid" do
      expect(normalize(level: -1).assessment_status).to eq(:invalid)
    end

    it "marks a non-integer numeric level (3.7) as invalid, not silently accepted" do
      expect(normalize(level: 3.7)).to have_attributes(assessment_status: :invalid, level: nil)
    end

    it "marks a non-integer numeric string level (\"3.7\") as invalid" do
      expect(normalize(level: "3.7").assessment_status).to eq(:invalid)
    end

    it "marks an out-of-range numeric string (\"7\") as invalid" do
      expect(normalize(level: "7").assessment_status).to eq(:invalid)
    end
  end

  describe "skill omitted entirely by the model (AC42)" do
    it "is not_assessed with reason omitted_by_model regardless of any level passed" do
      expect(normalize(omitted: true)).to have_attributes(
        assessment_status: :not_assessed, status_reason: :omitted_by_model, level: nil
      )
    end

    it "omission wins even if a level happens to be present" do
      expect(normalize(level: 4, omitted: true)).to have_attributes(
        assessment_status: :not_assessed, status_reason: :omitted_by_model, level: nil
      )
    end
  end

  describe "coverage was not_yet but the model scored it anyway (AC43)" do
    it "becomes needs_review and keeps the level" do
      expect(normalize(level: 3, coverage_state: "not_yet")).to have_attributes(
        assessment_status: :needs_review, level: 3
      )
    end

    it "accepts a symbol coverage_state the same way" do
      expect(normalize(level: 2, coverage_state: :not_yet)).to have_attributes(
        assessment_status: :needs_review, level: 2
      )
    end

    %w[covered partial initiated].each do |state|
      it "does not flag needs_review for coverage state #{state.inspect}" do
        expect(normalize(level: 3, coverage_state: state).assessment_status).to eq(:assessed)
      end
    end

    it "does not flag needs_review when coverage_state is nil (unknown/not applicable)" do
      expect(normalize(level: 3, coverage_state: nil).assessment_status).to eq(:assessed)
    end

    it "does not apply needs_review to a not_assessed level" do
      expect(normalize(level: nil, coverage_state: "not_yet").assessment_status).to eq(:not_assessed)
    end

    it "does not apply needs_review to an invalid level" do
      expect(normalize(level: 7, coverage_state: "not_yet").assessment_status).to eq(:invalid)
    end
  end

  describe "confidence normalization (AC44)" do
    [
      ["High", :high],
      ["high", :high],
      ["HIGH", :high],
      ["MeDiUm", :medium],
      ["low", :low]
    ].each do |raw, expected|
      it "normalizes #{raw.inspect} case-insensitively to #{expected.inspect}" do
        expect(normalize(level: 3, confidence: raw).confidence).to eq(expected)
      end
    end

    it "defaults to low when confidence is missing" do
      expect(normalize(level: 3, confidence: nil).confidence).to eq(:low)
    end

    ["very high", ""].each do |raw|
      it "defaults to low for unrecognized confidence #{raw.inspect}" do
        expect(normalize(level: 3, confidence: raw).confidence).to eq(:low)
      end
    end

    it "still normalizes confidence for a not_assessed outcome" do
      expect(normalize(level: nil, confidence: "High").confidence).to eq(:high)
    end

    it "still normalizes confidence for an invalid outcome" do
      expect(normalize(level: 7, confidence: "Medium").confidence).to eq(:medium)
    end

    it "still normalizes confidence for an omitted skill" do
      expect(normalize(omitted: true, confidence: "High").confidence).to eq(:high)
    end
  end

  describe "Result helpers" do
    it "flags an assessed result" do
      expect(normalize(level: 3)).to be_assessed
    end

    it "flags a not_assessed result" do
      expect(normalize(level: nil)).to be_not_assessed
    end

    it "flags a needs_review result" do
      expect(normalize(level: 3, coverage_state: "not_yet")).to be_needs_review
    end

    it "flags an invalid result" do
      expect(normalize(level: 7)).to be_invalid
    end
  end
end
