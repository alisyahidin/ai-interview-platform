# frozen_string_literal: true

FactoryBot.define do
  factory :portfolio_skill do
    association :portfolio
    sequence(:skill_id) { |n| "skill-#{n}" }
    skill_label { "Ruby on Rails" }
    is_discovered { false }
    ai_level { 3 }
    ai_confidence { "medium" }
    evidence { ["Discussed background job design under load."] }
    competency_summary { "Solid working knowledge, some gaps under scale." }

    # A skill the model never measured. `ai_level` is nil at the DB level
    # (schema #6 relaxed the NOT NULL + range check to allow this), and
    # PortfolioSkill's `ai_level` validation (ticket #8) now allows nil
    # whenever assessment_status != "assessed", so this saves cleanly.
    trait :not_assessed do
      ai_level { nil }
      ai_confidence { "low" }
      assessment_status { "not_assessed" }
      status_reason { "omitted_by_model" }
    end

    # Coverage said `not_yet` but the model scored it anyway — the level is
    # kept (not discarded), but the skill is flagged for human review and
    # excluded from fit/gap counts downstream. Per LevelNormalizer's
    # contract, a freshly-generated needs_review result always has
    # `status_reason: nil` -- `legacy_unverified` is reserved for the
    # one-time migration backfill (ticket #6), a different scenario.
    trait :needs_review do
      assessment_status { "needs_review" }
      status_reason { nil }
    end
  end
end
