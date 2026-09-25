# frozen_string_literal: true

FactoryBot.define do
  factory :assessor_override do
    association :portfolio_skill
    ai_level { portfolio_skill.ai_level || 3 }
    override_level { 5 }
    assessor_notes { "Candidate demonstrated stronger skill than the AI score reflects." }
    overridden_by { 1 }
    overridden_at { Time.current }
  end
end
