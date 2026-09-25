# frozen_string_literal: true

class PortfolioSkill < ApplicationRecord
  CONFIDENCE_LEVELS = %w[high medium low].freeze

  belongs_to :portfolio
  has_one :assessor_override, dependent: :destroy

  validates :skill_label, presence: true
  # #6/#8: ai_level is nullable at the DB level (CHECK allows NULL only when
  # assessment_status != 'assessed'). A :not_assessed skill legitimately has
  # no level; an :assessed one still must have a real 1..5 integer.
  validates :ai_level, numericality: { only_integer: true, in: 1..5 }, allow_nil: true
  validates :ai_level, presence: true, if: -> { assessment_status == "assessed" }
  validates :ai_confidence, inclusion: { in: CONFIDENCE_LEVELS }
  validates :competency_summary, presence: true

  # evidence is stored as JSONB array of quote strings
  def evidence_quotes
    Array(evidence)
  end
end
