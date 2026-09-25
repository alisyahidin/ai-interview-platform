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
    # (schema #6 relaxed the NOT NULL + range check to allow this), but
    # PortfolioSkill's `ai_level` numericality validation hasn't been updated
    # for that yet (ticket #8, out of scope here) — save without validation
    # so this factory can still produce a persisted, DB-legal row.
    trait :not_assessed do
      ai_level { nil }
      ai_confidence { "low" }
      assessment_status { "not_assessed" }
      status_reason { "omitted_by_model" }

      to_create { |instance| instance.save(validate: false) }
    end

    # Coverage said `not_yet` but the model scored it anyway — the level is
    # kept (not discarded), but the skill is flagged for human review and
    # excluded from fit/gap counts downstream.
    trait :needs_review do
      assessment_status { "needs_review" }
      status_reason { "legacy_unverified" }
    end
  end
end
